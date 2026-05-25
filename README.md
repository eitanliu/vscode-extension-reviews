# Extension Reviews

A VS Code extension that shows Marketplace ratings and reviews in the sidebar while browsing extensions.

## Features

- **Auto-load**: Open the Reviews sidebar (★ icon) while viewing an extension's details page — reviews load automatically
- **Follow tab**: When the sidebar is visible, switching between extension detail tabs updates reviews in real time
- **Manual trigger**: Right-click any extension in the Extensions panel → **View Extension Reviews**
- **Search**: Use the search box in the sidebar to look up any extension by name
- **Pagination**: Browse through all reviews with previous/next page controls

## Settings

| Setting | Default | Description |
|---|---|---|
| `extensionReviews.autoLoad` | `false` | Automatically load reviews when switching extension detail tabs, even when the sidebar is not open |

## Usage

1. Open the Extensions panel (`Ctrl+Shift+X`)
2. Click any extension to open its details page
3. Click the ★ icon in the Activity Bar to open the Reviews sidebar
4. Reviews for the current extension load automatically

Or right-click any extension → **View Extension Reviews**.

## Development

```bash
npm install
npm run compile   # build
npm run watch     # watch mode
```

Press `F5` in VS Code to launch an Extension Development Host for testing.
