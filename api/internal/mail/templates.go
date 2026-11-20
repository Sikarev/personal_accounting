package mail

import (
	htmltemplate "html/template"
	"strings"
	texttemplate "text/template"
)

// Шаблоны писем. Текстовую версию собирает text/template (без экранирования),
// HTML — html/template: он сам экранирует подставленные значения (имя
// пользователя), поэтому имя вида «<script>» не превратится в разметку.
//
// Сроки действия ссылок в текстах должны совпадать с verifyEmailTokenTTL
// и resetPasswordTokenTTL в internal/httpapi/email.go.

// Letter — данные для шаблона письма.
type Letter struct {
	Name  string // имя пользователя из профиля
	Email string // адрес, на который уходит письмо
	Link  string // ссылка с токеном
}

type template struct {
	subject string
	text    *texttemplate.Template
	html    *htmltemplate.Template
}

const htmlLayout = `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>{{template "subject" .}}</title></head>
<body style="font-family: Arial, sans-serif; font-size: 16px; line-height: 1.5; color: #1a1b1e;">
{{template "body" .}}
<p style="color: #868e96; font-size: 14px;">Домашняя бухгалтерия</p>
</body>
</html>`

// button — ссылка-кнопка; рядом всегда есть ссылка текстом на случай,
// если почтовый клиент не показывает стили.
const htmlButton = `<p><a href="{{.Link}}" style="display: inline-block; padding: 12px 20px; background: #4c6ef5; color: #ffffff; text-decoration: none; border-radius: 6px;">{{.Label}}</a></p>
<p style="font-size: 14px;">Если кнопка не открывается, скопируйте ссылку в браузер:<br><a href="{{.Link}}">{{.Link}}</a></p>`

func newTemplate(subject, text, html string) template {
	// button собирает данные для шаблона кнопки: в шаблонах Go нельзя
	// создать структуру, а передать в вложенный шаблон можно только одно значение.
	funcs := htmltemplate.FuncMap{"button": func(link, label string) map[string]string {
		return map[string]string{"Link": link, "Label": label}
	}}
	h := htmltemplate.Must(htmltemplate.New("layout").Funcs(funcs).Parse(htmlLayout))
	htmltemplate.Must(h.New("button").Parse(htmlButton))
	htmltemplate.Must(h.New("subject").Parse(subject))
	htmltemplate.Must(h.New("body").Parse(html))
	return template{
		subject: subject,
		text:    texttemplate.Must(texttemplate.New("text").Parse(text)),
		html:    h,
	}
}

// render собирает письмо для адреса l.Email.
func (t template) render(l Letter) (Message, error) {
	var text, html strings.Builder
	if err := t.text.Execute(&text, l); err != nil {
		return Message{}, err
	}
	if err := t.html.ExecuteTemplate(&html, "layout", l); err != nil {
		return Message{}, err
	}
	return Message{To: l.Email, Subject: t.subject, Text: text.String(), HTML: html.String()}, nil
}

// Шаблоны разбираются один раз при запуске программы. Must паникует при
// синтаксической ошибке в шаблоне — это ошибка в коде, её покажет любой тест.
var (
	verifyEmailTemplate = newTemplate(
		"Подтвердите e-mail в Домашней бухгалтерии",
		`Здравствуйте, {{.Name}}!

Чтобы подтвердить адрес {{.Email}}, откройте ссылку:
{{.Link}}

Ссылка действует 24 часа.

Если вы не регистрировались в Домашней бухгалтерии, просто удалите это письмо.
`,
		`<p>Здравствуйте, {{.Name}}!</p>
<p>Чтобы подтвердить адрес {{.Email}}, нажмите кнопку:</p>
{{template "button" (button .Link "Подтвердить e-mail")}}
<p>Ссылка действует 24 часа.</p>
<p>Если вы не регистрировались в Домашней бухгалтерии, просто удалите это письмо.</p>`,
	)

	resetPasswordTemplate = newTemplate(
		"Восстановление пароля в Домашней бухгалтерии",
		`Здравствуйте, {{.Name}}!

Мы получили запрос на сброс пароля для {{.Email}}. Чтобы задать новый пароль, откройте ссылку:
{{.Link}}

Ссылка действует 1 час и сработает один раз. После смены пароля вход на всех устройствах будет завершён.

Если вы не запрашивали сброс, просто удалите это письмо — пароль останется прежним.
`,
		`<p>Здравствуйте, {{.Name}}!</p>
<p>Мы получили запрос на сброс пароля для {{.Email}}. Чтобы задать новый пароль, нажмите кнопку:</p>
{{template "button" (button .Link "Задать новый пароль")}}
<p>Ссылка действует 1 час и сработает один раз. После смены пароля вход на всех устройствах будет завершён.</p>
<p>Если вы не запрашивали сброс, просто удалите это письмо — пароль останется прежним.</p>`,
	)
)

// VerifyEmail — письмо со ссылкой подтверждения e-mail.
func VerifyEmail(l Letter) (Message, error) { return verifyEmailTemplate.render(l) }

// ResetPassword — письмо со ссылкой для сброса пароля.
func ResetPassword(l Letter) (Message, error) { return resetPasswordTemplate.render(l) }
