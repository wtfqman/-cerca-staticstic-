# DOCX document templates

Runtime source of truth is this folder: `src/templates/documents-docx/**/template.docx`.

Do not edit these files through Pages or another converter and commit them silently. If a template comes from Google Docs or from an approved DOCX example, import it through the controlled import:

```bash
npm run templates:import-google-docs
```

The import reads template document IDs or URLs from:

- `DOC_TEMPLATE_*` environment variables, or
- `src/templates/documents-docx/sources.local.json`

`sources.local.json` is intentionally ignored. Use `sources.example.json` as the shape.

After import the script:

1. downloads each Google Doc as DOCX or copies the approved local DOCX example;
2. validates that it is a readable DOCX with `word/document.xml`;
3. writes the normalized local `template.docx`;
4. refreshes `manifest.json` with size and SHA-256.

The bot verifies `manifest.json` before rendering. If a DOCX is replaced manually and the checksum changes, generation fails loudly instead of using an unknown shifted template.
