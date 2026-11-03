# Regression corpus

Every case here is a real-world shape of email, made up for a fictional brand ("Fernbrook Market").
**Every wrong result someone reports becomes a case in this folder** before it gets fixed, so the
same mistake can never come back silently.

Each case has:
- `email.html`: the template, with the platform's own personalization syntax
- `case.json`: `platform`, optional `subject`, and `mustFind` / `mustNotFind` lists of check ids

No real customer data, no real company's templates, ever.
