# Contributing

Issues and pull requests are welcome.

## Development

```bash
npm install
npm run dev        # playground with a mock Home Assistant
npm test
npm run build
```

Run `npm test` and `npm run build` before you open a pull request.

## Add a card to the showroom

1. Create a folder `showroom/<your-card>/` (lowercase, words separated by `-`) with three files:
   - `card.html`: the card, exactly as you paste it into the card editor. Start with a comment that says what it does and which entities to replace.
   - `screenshot.png`: one picture of the card, at most 400 KB.
   - `README.md`: copy one from an existing card and fill in the title, description, **Needs**, **Rating** and **Author**.
2. Add a row for your card to the table in `showroom/README.md`.
3. Run `npm test`. It checks the files and tells you the rating to write down if yours does not match.
4. Open a pull request.

Rules:

- Use placeholder entities (`light.living_room`), never tokens, passwords or private addresses.
- The screenshot shows the card only, without private details.
- A card rated red needs a line `- **Why red:** …` in its README that explains why it needs what it does. It may still be declined.
- Cards should work in a narrow dashboard column as well as a wide one.

By contributing you agree that your contribution is published under the [MIT License](LICENSE), and that your card may be shown in the project README.
