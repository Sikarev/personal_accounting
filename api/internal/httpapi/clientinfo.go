package httpapi

import (
	"context"
	"net/http"
	"net/netip"
	"strings"
	"unicode/utf8"
)

// clientInfo — сведения о клиенте, которые нужны обработчикам и логу:
// strict-обработчики получают только context, а не *http.Request.
type clientInfo struct {
	IP        netip.Addr // невалидный (IsValid() == false), если адрес не разобрать
	UserAgent string     // обрезан и очищен для записи в БД
}

// Ключи контекста — значения неэкспортируемого типа: так другой пакет
// не перезапишет их случайно своим ключом с тем же «именем».
type ctxKey int

const (
	clientInfoKey ctxKey = iota
	sessionTokenKey
	principalKey
)

// maxUserAgentLen — сколько байт User-Agent храним в sessions.user_agent.
// Реальные строки — 100–300 байт; больше — мусор или попытка раздуть БД.
const maxUserAgentLen = 512

// withClientInfo определяет реальный IP клиента и кладёт его вместе
// с User-Agent в контекст. Стоит первым, чтобы IP попал и в лог запросов.
func withClientInfo(trustedProxies []netip.Prefix) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			info := clientInfo{
				IP:        clientIP(r.RemoteAddr, r.Header.Values("X-Forwarded-For"), trustedProxies),
				UserAgent: sanitizeUserAgent(r.UserAgent()),
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), clientInfoKey, info)))
		})
	}
}

// clientInfoFrom возвращает сведения о клиенте из контекста (нулевые, если их нет).
func clientInfoFrom(ctx context.Context) clientInfo {
	info, _ := ctx.Value(clientInfoKey).(clientInfo) // «, _» — нет значения → нулевая структура
	return info
}

// clientIP определяет адрес клиента.
//
// Если соединение пришло не от доверенного прокси, клиент — сам адрес
// соединения, а X-Forwarded-For игнорируется: его может прислать кто угодно.
// Если от доверенного — идём по X-Forwarded-For справа налево (каждый прокси
// дописывает адрес, от которого получил запрос, в конец), пропуская доверенные
// адреса; первый недоверенный — клиент. Левее него значения мог подделать
// сам клиент, поэтому дальше не смотрим.
func clientIP(remoteAddr string, xff []string, trusted []netip.Prefix) netip.Addr {
	addr := parseAddr(remoteAddr)
	if !addr.IsValid() || !isTrusted(addr, trusted) {
		return addr
	}
	// Несколько заголовков X-Forwarded-For равносильны одному со значениями через запятую.
	hops := strings.Split(strings.Join(xff, ","), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		hop := parseAddr(hops[i])
		if !hop.IsValid() {
			// Мусор там, где доверенный прокси должен был записать адрес:
			// верим только тому, что уже проверили, — последнему прокси.
			return addr
		}
		if !isTrusted(hop, trusted) {
			return hop
		}
		addr = hop
	}
	// Вся цепочка из доверенных адресов: клиент — самый левый из них.
	return addr
}

// parseAddr разбирает "ip", "ip:port" или "[ipv6]:port". IPv4, записанный
// как IPv6 (::ffff:1.2.3.4), приводится к IPv4, зона IPv6 (%eth0) отбрасывается:
// тип inet в Postgres её не принимает.
func parseAddr(s string) netip.Addr {
	s = strings.TrimSpace(s)
	if ap, err := netip.ParseAddrPort(s); err == nil {
		return ap.Addr().Unmap().WithZone("")
	}
	if a, err := netip.ParseAddr(s); err == nil {
		return a.Unmap().WithZone("")
	}
	return netip.Addr{}
}

func isTrusted(a netip.Addr, trusted []netip.Prefix) bool {
	for _, p := range trusted {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// rateLimitKey — ключ ограничения частоты по адресу. Для IPv6 берётся сеть /64:
// провайдер обычно выдаёт клиенту целую /64, и смена адреса внутри неё
// не должна обнулять счётчик.
func rateLimitKey(a netip.Addr) string {
	switch {
	case !a.IsValid():
		return "unknown"
	case a.Is6():
		p, _ := a.Prefix(64) // ошибки нет: 64 ≤ 128
		return p.String()
	default:
		return a.String()
	}
}

// sanitizeUserAgent готовит User-Agent к записи в text-колонку: Postgres
// не принимает невалидный UTF-8 и нулевой байт, а длину ограничиваем.
func sanitizeUserAgent(ua string) string {
	ua = strings.ToValidUTF8(ua, "")
	ua = strings.ReplaceAll(ua, "\x00", "")
	if len(ua) <= maxUserAgentLen {
		return ua
	}
	// Режем по границе символа, чтобы не разрезать многобайтовый символ пополам.
	cut := maxUserAgentLen
	for cut > 0 && !utf8.RuneStart(ua[cut]) {
		cut--
	}
	return ua[:cut]
}
