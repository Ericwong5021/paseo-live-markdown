Write Markdown in a Paseo workspace tab with a live preview. **+ → Markdown** starts a draft in memory. Choose a path when you save it for the first time. The first save never replaces an existing file, and later edits autosave. The preview uses the same renderer as Paseo's agent messages and shows YAML front matter as a table.

On desktop and web, open a Markdown file with the plugin to edit, preview, or show both panes at once. If a file changes on disk while you have unsaved edits, choose whether to reload or overwrite. On iOS and Android, the new-tab panel can edit with a plain-text editor, and existing file tabs offer a read-only preview and source view.

Requires Paseo 0.15.3 or later with plugins enabled. Git installations need npm on the Paseo host to install the locked editor and YAML dependencies. No account or API key is needed.

The plugin reads and writes Markdown files in the selected workspace on the Paseo host. It does not send document text to an agent provider or collect telemetry. Paseo's preview can fetch remote images referenced in the document. Relative image paths are not resolved by the plugin preview.
