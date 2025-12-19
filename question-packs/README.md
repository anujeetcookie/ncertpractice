## Question Packs

You can add more questions without editing code by dropping JSON files in this folder.

### Format

Each `*.json` file should contain either:

- an array of question objects, or
- an object with a `questions` array.

Each question object supports:

```json
{
  "id": "unique-id",
  "grade": 10,
  "subject": "Mathematics",
  "chapter": "Quadratic Equations",
  "type": "mcq",
  "source": "vedantu",
  "tags": ["pyq-style", "important"],
  "question": "...",
  "options": ["A", "B", "C", "D"],
  "correctOption": 2,
  "answer": "...",
  "keywords": ["..."],
  "diagram": "angle-elevation"
}
```

Notes:

- `type` must be one of: `long`, `short`, `mcq`, `numerical`.
- For `mcq`, you must provide `options` and `correctOption` (1-based index).
- `diagram` should match an SVG file in [`public/diagrams`](public/diagrams/number-line-sqrt3.svg:1) without the `.svg` extension.

### Copyright / Licensing

Only add question packs if you have the right to use and distribute that content.

