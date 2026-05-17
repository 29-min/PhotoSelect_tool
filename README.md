# PhotoSelect

Electron + React desktop app for quickly reviewing photo shoots and selecting keepers.

## Features

- Open a folder containing JPG and/or RAW files
- Navigate photos with keyboard shortcuts
- Mark selected photos while reviewing
- Filter to selected photos only
- Review selected items in a side panel
- Export selected files as `RAW`, `JPG`, or both

## Shortcuts

- `Left Arrow`: previous photo
- `Right Arrow`: next photo
- `Space`: pick/unpick current photo
- `P`: pick/unpick current photo

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build:mac
npm run build:win
```

## Stack

- Electron
- React
- TypeScript
- Vite
- Tailwind CSS
- exiftool-vendored
