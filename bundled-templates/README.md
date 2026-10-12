# Built-in XPlain templates

These folders ship inside the extension VSIX and appear as **built-in** templates
(read-only). Users can duplicate them to **user** or **project** scope to customize.

Each template is a directory:

```
<id>/
  template.json          # id must equal the folder name; scope is forced to "builtin" at load
  files/                 # optional attached text files
    checklist.md
```

Add new defaults here, then bump the extension and reinstall.
