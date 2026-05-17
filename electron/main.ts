import { app, BrowserWindow, ipcMain, dialog, nativeImage } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import fsPromises from 'node:fs/promises'
import { exiftool } from 'exiftool-vendored'

// __dirname is natively available in CJS

// Set process env
process.env.APP_ROOT = path.join(__dirname, '..')
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

const SUPPORTED_EXTS = ['.jpg', '.jpeg', '.cr2', '.cr3', '.nef', '.arw', '.raf', '.dng', '.orf', '.rw2']
const PREVIEW_CACHE_LIMIT = 24
const THUMBNAIL_CACHE_LIMIT = 240

type PreviewData = { url: string, orientation: number }

const previewCache = new Map<string, PreviewData | null>()
const thumbnailCache = new Map<string, string | null>()
const previewRequests = new Map<string, Promise<PreviewData | null>>()
const thumbnailRequests = new Map<string, Promise<string | null>>()

function getCached<K, V>(cache: Map<K, V>, key: K) {
  if (!cache.has(key)) return undefined
  const value = cache.get(key)!
  cache.delete(key)
  cache.set(key, value)
  return value
}

function setCached<K, V>(cache: Map<K, V>, key: K, value: V, limit: number) {
  cache.set(key, value)
  if (cache.size > limit) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
}

async function createSystemThumbnailDataUrl(filePath: string, size: number) {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return null

  try {
    const image = await nativeImage.createThumbnailFromPath(filePath, {
      width: size,
      height: size,
    })

    if (image.isEmpty()) return null
    return image.toDataURL()
  } catch (e) {
    console.error("Failed to create system thumbnail for", filePath, e)
    return null
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  exiftool.end() // ensure exiftool is closed
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  // IPC Handlers
  ipcMain.handle('dialog:openFolder', async () => {
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths[0]
  })

  ipcMain.handle('fs:readDir', async (_, dirPath) => {
    try {
      const files = await fsPromises.readdir(dirPath)
      const imageFiles = files
        .filter(f => SUPPORTED_EXTS.includes(path.extname(f).toLowerCase()))
        .map(f => ({
          name: f,
          path: path.join(dirPath, f),
          ext: path.extname(f).toLowerCase()
        }))
      return imageFiles
    } catch (e) {
      console.error(e)
      return []
    }
  })

  ipcMain.handle('exif:getPreview', async (_, filePath) => {
    const cached = getCached(previewCache, filePath)
    if (cached !== undefined) return cached

    const existingRequest = previewRequests.get(filePath)
    if (existingRequest) return existingRequest

    const request = (async (): Promise<PreviewData | null> => {
      try {
        const ext = path.extname(filePath).toLowerCase()
        if (ext === '.jpg' || ext === '.jpeg') {
          // Return absolute file URI to be loaded natively by the browser
          return { url: pathToFileURL(filePath).toString(), orientation: 1 }
        }

        // Read orientation from the RAW file directly
        let orientation = 1
        try {
          const rawTags = await exiftool.readRaw(filePath, ['-Orientation', '-n'])
          if (rawTags.Orientation) {
            orientation = parseInt(rawTags.Orientation as string, 10) || 1
          }
        } catch (e) { /* ignore */ }

        // For RAW files, extract preview as buffer directly
        let buffer: Buffer | null = null

        try {
          buffer = await exiftool.extractBinaryTagToBuffer('PreviewImage', filePath)
        } catch (e) { /* ignore */ }

        if (!buffer) {
          try {
            buffer = await exiftool.extractBinaryTagToBuffer('JpgFromRaw', filePath)
          } catch (e) { /* ignore */ }
        }

        if (!buffer) {
          try {
            buffer = await exiftool.extractBinaryTagToBuffer('ThumbnailImage', filePath)
          } catch (e) { /* ignore */ }
        }

        if (buffer) {
          return {
            url: `data:image/jpeg;base64,${buffer.toString('base64')}`,
            orientation
          }
        }

        const systemThumbnail = await createSystemThumbnailDataUrl(filePath, 2200)
        if (systemThumbnail) {
          return {
            url: systemThumbnail,
            orientation: 1
          }
        }

        console.error("All extraction methods failed for", filePath)
        return null
      } catch (e) {
        console.error("Failed to extract preview for", filePath, e)
        return null
      }
    })()

    previewRequests.set(filePath, request)
    try {
      const result = await request
      setCached(previewCache, filePath, result, PREVIEW_CACHE_LIMIT)
      return result
    } finally {
      previewRequests.delete(filePath)
    }
  })

  // Fast thumbnail extractor for the filmstrip
  ipcMain.handle('exif:getThumbnail', async (_, filePath) => {
    const cached = getCached(thumbnailCache, filePath)
    if (cached !== undefined) return cached

    const existingRequest = thumbnailRequests.get(filePath)
    if (existingRequest) return existingRequest

    const request = (async (): Promise<string | null> => {
      try {
        let buffer = await exiftool.extractBinaryTagToBuffer('ThumbnailImage', filePath)
        if (!buffer) {
          buffer = await exiftool.extractBinaryTagToBuffer('JpgFromRaw', filePath)
        }
        if (buffer) {
          return `data:image/jpeg;base64,${buffer.toString('base64')}`
        }
      } catch (e) { /* ignore */ }

      return createSystemThumbnailDataUrl(filePath, 240)
    })()

    thumbnailRequests.set(filePath, request)
    try {
      const result = await request
      setCached(thumbnailCache, filePath, result, THUMBNAIL_CACHE_LIMIT)
      return result
    } finally {
      thumbnailRequests.delete(filePath)
    }
  })

  // Also add an export handler
  ipcMain.handle('fs:exportFiles', async (_, { filePaths, targetDir, mode }) => {
    // mode can be 'raw', 'jpg', 'both'
    // This will be implemented next
    let copied = 0
    for (const file of filePaths) {
      // Basic implementation for now: copy the file itself
      const fileName = path.basename(file)
      const dest = path.join(targetDir, fileName)
      await fsPromises.copyFile(file, dest)
      copied++
      
      // If mode is 'both' and the file is RAW, look for JPG.
      // If mode is 'both' and the file is JPG, look for RAW.
      // We will refine this logic.
    }
    return copied
  })


  createWindow()
})
