The `unibe_new_work_content.html`, `unibe_valuation_content.html`, and
`unibe_psychopathologie_content.html` fixtures come from the user's saved ILIAS
course pages. Only the course heading and central content column are retained.
Account navigation, scripts, comments and event handlers were removed; request
tokens were replaced with fixture values.

These portable fixtures replace tests that searched the working directory for
private browser downloads. They preserve the drawer, material and session
structures exercised by the existing regression assertions.
