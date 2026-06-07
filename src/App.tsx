import { useState, useEffect, useCallback, useRef } from 'react'

interface ImageFile {
  name: string
  path: string
  ext: string
}

interface ImageGroup {
  baseName: string
  raw?: ImageFile
  jpg?: ImageFile
  selected: boolean
}

interface PreviewData {
  url: string
  orientation: number
}

type Locale = 'ko' | 'en'

const messages = {
  ko: {
    welcomeSubtitle: '사진 폴더를 선택하여 마음에 드는 사진만 골라내기.',
    openPhotoFolder: '사진 폴더 열기',
    back: '← 뒤로',
    progress: (current: number, total: number, selectedOnly: boolean) =>
      `${total}개 묶음 중 ${current}번째${selectedOnly ? ' · 선택만 보기' : ''}`,
    jpgFirst: 'JPG 우선보기',
    rawFirst: 'RAW 우선보기',
    selectedOnly: '선택된 사진만 보기',
    exportSelected: (count: number) => `선택 항목 내보내기 (${count})`,
    previewUnavailable: '미리보기를 불러올 수 없습니다',
    selected: '선택됨 (P)',
    pick: '선택 (Space)',
    selectedPhotos: '선택된 사진',
    selectedCount: (count: number) => `${count}개`,
    noSelectedPhotos: '선택된 사진 없음',
    exportTitle: '사진 내보내기',
    exportDescription: (count: number) => `총 ${count}개의 사진 묶음이 선택되었습니다.`,
    exportBothTitle: '모두 복사 (RAW + JPG)',
    exportBothDescription: '선택된 사진의 원본과 JPG 파일이 모두 복사됩니다.',
    exportRawTitle: 'RAW 파일만 복사',
    exportRawDescription: '보정을 위해 용량이 큰 원본(RAW) 파일만 복사합니다.',
    exportJpgTitle: 'JPG 파일만 복사',
    exportJpgDescription: '가벼운 JPG 파일만 추출합니다.',
    cancel: '취소',
    chooseFolderAndCopy: '폴더 선택 및 복사',
    exportEmptyAlert: '추출할 파일이 없습니다. (조건에 맞는 선택된 사진 없음)',
    exportSuccessAlert: (count: number) => `총 ${count}개의 파일이 성공적으로 복사되었습니다!`,
  },
  en: {
    welcomeSubtitle: 'Open a photo folder and keep only the shots you like.',
    openPhotoFolder: 'Open Photo Folder',
    back: '← Back',
    progress: (current: number, total: number, selectedOnly: boolean) =>
      `${current} of ${total} groups${selectedOnly ? ' · Selected only' : ''}`,
    jpgFirst: 'Prefer JPG',
    rawFirst: 'Prefer RAW',
    selectedOnly: 'Selected Only',
    exportSelected: (count: number) => `Export Selected (${count})`,
    previewUnavailable: 'Preview unavailable',
    selected: 'Selected (P)',
    pick: 'Pick (Space)',
    selectedPhotos: 'Selected Photos',
    selectedCount: (count: number) => `${count}`,
    noSelectedPhotos: 'No selected photos',
    exportTitle: 'Export Photos',
    exportDescription: (count: number) => `${count} photo groups selected.`,
    exportBothTitle: 'Copy All (RAW + JPG)',
    exportBothDescription: 'Copy both the original RAW files and JPG files for selected photos.',
    exportRawTitle: 'Copy RAW Only',
    exportRawDescription: 'Copy only the larger original RAW files for editing.',
    exportJpgTitle: 'Copy JPG Only',
    exportJpgDescription: 'Copy only lightweight JPG files.',
    cancel: 'Cancel',
    chooseFolderAndCopy: 'Choose Folder and Copy',
    exportEmptyAlert: 'No files to export. No selected photos match this option.',
    exportSuccessAlert: (count: number) => `${count} files copied successfully.`,
  },
} satisfies Record<Locale, Record<string, string | ((...args: never[]) => string)>>

const getPreferredLocale = (): Locale => {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  return languages.some(language => language?.toLowerCase().startsWith('ko')) ? 'ko' : 'en'
}

const CanvasRotatedImage = ({ src, orientation, className }: { src: string, orientation: number, className?: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!src || !canvasRef.current) return
    const img = new Image()
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      let width = img.width
      let height = img.height

      // Limit canvas size to prevent memory crashes on fast navigation
      const MAX_DIM = 2400
      if (width > MAX_DIM || height > MAX_DIM) {
        const scale = Math.min(MAX_DIM / width, MAX_DIM / height)
        width = width * scale
        height = height * scale
      }

      if (orientation >= 5 && orientation <= 8) {
        canvas.width = height
        canvas.height = width
      } else {
        canvas.width = width
        canvas.height = height
      }

      ctx.save()
      switch (orientation) {
        case 2: ctx.transform(-1, 0, 0, 1, width, 0); break;
        case 3: ctx.transform(-1, 0, 0, -1, width, height); break;
        case 4: ctx.transform(1, 0, 0, -1, 0, height); break;
        case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
        case 6: ctx.transform(0, 1, -1, 0, height, 0); break;
        case 7: ctx.transform(0, -1, -1, 0, height, width); break;
        case 8: ctx.transform(0, -1, 1, 0, 0, width); break;
        default: break;
      }
      ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, width, height)
      ctx.restore()
    }
    img.src = src
  }, [src, orientation])

  return <canvas ref={canvasRef} className={className} />
}

const RotatedImage = ({ src, orientation, className }: { src: string, orientation: number, className?: string }) => {
  if (orientation === 1) {
    return <img src={src} className={className} draggable={false} />
  }

  return <CanvasRotatedImage src={src} orientation={orientation} className={className} />
}

function App() {
  const [locale] = useState<Locale>(getPreferredLocale)
  const [folder, setFolder] = useState<string | null>(null)
  const [imageGroups, setImageGroups] = useState<ImageGroup[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [currentPreview, setCurrentPreview] = useState<PreviewData | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const requestIndexRef = useRef(0)
  const previewCacheRef = useRef(new Map<string, Promise<PreviewData | null>>())

  // Settings
  const [viewPriority, setViewPriority] = useState<'jpg' | 'raw'>('jpg')
  const [showSelectedOnly, setShowSelectedOnly] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportMode, setExportMode] = useState<'both' | 'raw' | 'jpg'>('both')
  const t = messages[locale]

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const openFolder = async () => {
    // @ts-ignore
    const selectedFolder = await window.ipcRenderer.openFolder()
    if (selectedFolder) {
      setFolder(selectedFolder)
      loadImages(selectedFolder)
    }
  }

  const loadImages = async (dirPath: string) => {
    // @ts-ignore
    const files: ImageFile[] = await window.ipcRenderer.readDir(dirPath)

    // Group files by base name (e.g., IMG_0001.CR2 and IMG_0001.JPG)
    const groupsMap = new Map<string, ImageGroup>()

    files.forEach(file => {
      // Use case-insensitive replace from the end of the string
      const baseName = file.name.replace(new RegExp(`\\${file.ext}$`, 'i'), '')
      if (!groupsMap.has(baseName)) {
        groupsMap.set(baseName, { baseName, selected: false })
      }

      const group = groupsMap.get(baseName)!
      if (file.ext.toLowerCase() === '.jpg' || file.ext.toLowerCase() === '.jpeg') {
        group.jpg = file
      } else {
        group.raw = file
      }
    })

    // Convert to sorted array
    const sortedGroups = Array.from(groupsMap.values()).sort((a, b) => a.baseName.localeCompare(b.baseName))
    previewCacheRef.current.clear()
    setImageGroups(sortedGroups)
    setCurrentIndex(0)
  }

  const getPreviewFile = useCallback((index: number) => {
    const group = imageGroups[index]

    // Decide which file to preview based on priority
    let fileToPreview: ImageFile | null = null
    if (viewPriority === 'jpg' && group.jpg) {
      fileToPreview = group.jpg
    } else if (group.raw) {
      fileToPreview = group.raw
    } else if (group.jpg) {
      fileToPreview = group.jpg
    }

    return fileToPreview
  }, [imageGroups, viewPriority])

  const getPreview = useCallback((index: number) => {
    if (index < 0 || index >= imageGroups.length) return Promise.resolve(null)

    const group = imageGroups[index]
    const fileToPreview = getPreviewFile(index)
    const cacheKey = `${viewPriority}:${group.raw?.path || ''}:${group.jpg?.path || ''}`

    const cached = previewCacheRef.current.get(cacheKey)
    if (cached) return cached

    const request = (async (): Promise<PreviewData | null> => {
      if (fileToPreview) {
        // @ts-ignore
        let previewData = await window.ipcRenderer.getPreview(fileToPreview.path)

        // Fallback to JPG if RAW extraction failed but we have a JPG available
        if (!previewData && fileToPreview === group.raw && group.jpg) {
          // @ts-ignore
          previewData = await window.ipcRenderer.getPreview(group.jpg.path)
        }

        if (previewData?.url) {
          const img = new Image()
          img.src = previewData.url
          if (img.decode) {
            try {
              await img.decode()
            } catch {
              // The browser can still render some images even when decode rejects.
            }
          }
        }

        return previewData || null
      }

      return null
    })()

    previewCacheRef.current.set(cacheKey, request)
    if (previewCacheRef.current.size > 12) {
      const oldestKey = previewCacheRef.current.keys().next().value
      if (oldestKey) previewCacheRef.current.delete(oldestKey)
    }

    return request
  }, [getPreviewFile, imageGroups, viewPriority])

  const loadPreview = useCallback(async (index: number) => {
    if (index < 0 || index >= imageGroups.length) return
    requestIndexRef.current = index
    setLoadingPreview(true)

    const previewData = await getPreview(index)

    if (requestIndexRef.current === index) {
      setCurrentPreview(previewData)
    }

    if (requestIndexRef.current === index) {
      setLoadingPreview(false)
      window.setTimeout(() => {
        if (requestIndexRef.current === index) {
          void getPreview(index + 1)
        }
      }, 180)
    }
  }, [getPreview, imageGroups.length])

  useEffect(() => {
    if (imageGroups.length > 0) {
      loadPreview(currentIndex)
    }
  }, [currentIndex, imageGroups, loadPreview])

  useEffect(() => {
    if (!showSelectedOnly) return

    const selectedIndex = imageGroups.findIndex(group => group.selected)
    if (selectedIndex === -1) {
      setShowSelectedOnly(false)
      return
    }

    if (!imageGroups[currentIndex]?.selected) {
      setCurrentIndex(selectedIndex)
    }
  }, [currentIndex, imageGroups, showSelectedOnly])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showExportModal) return // Don't trigger if modal is open

      if (e.key === 'ArrowRight') {
        if (showSelectedOnly) {
          const selectedIndexes = imageGroups.flatMap((group, index) => group.selected ? [index] : [])
          const visiblePosition = selectedIndexes.indexOf(currentIndex)
          const nextPosition = Math.min(visiblePosition + 1, selectedIndexes.length - 1)
          setCurrentIndex(selectedIndexes[nextPosition] ?? currentIndex)
        } else {
          setCurrentIndex(prev => Math.min(prev + 1, imageGroups.length - 1))
        }
      } else if (e.key === 'ArrowLeft') {
        if (showSelectedOnly) {
          const selectedIndexes = imageGroups.flatMap((group, index) => group.selected ? [index] : [])
          const visiblePosition = selectedIndexes.indexOf(currentIndex)
          const previousPosition = Math.max(visiblePosition - 1, 0)
          setCurrentIndex(selectedIndexes[previousPosition] ?? currentIndex)
        } else {
          setCurrentIndex(prev => Math.max(prev - 1, 0))
        }
      } else if (e.key === ' ' || e.key.toLowerCase() === 'p') {
        e.preventDefault()
        toggleSelection(currentIndex)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentIndex, imageGroups, showExportModal, showSelectedOnly])

  const toggleSelection = (index: number) => {
    setImageGroups(prev => {
      const newGroups = [...prev]
      newGroups[index] = { ...newGroups[index], selected: !newGroups[index].selected }
      return newGroups
    })
  }

  const handleExport = async () => {
    // @ts-ignore
    const targetDir = await window.ipcRenderer.openFolder()
    if (!targetDir) return

    const selectedGroups = imageGroups.filter(g => g.selected)
    const filesToExport: string[] = []

    selectedGroups.forEach(g => {
      if ((exportMode === 'both' || exportMode === 'raw') && g.raw) {
        filesToExport.push(g.raw.path)
      }
      if ((exportMode === 'both' || exportMode === 'jpg') && g.jpg) {
        filesToExport.push(g.jpg.path)
      }
    })

    if (filesToExport.length === 0) {
      alert(t.exportEmptyAlert)
      return
    }

    // @ts-ignore
    const copiedCount = await window.ipcRenderer.exportFiles({
      filePaths: filesToExport,
      targetDir,
      mode: exportMode
    })

    alert(t.exportSuccessAlert(copiedCount))
    setShowExportModal(false)
  }

  const selectedCount = imageGroups.filter(g => g.selected).length

  if (!folder || imageGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-zinc-50 text-zinc-900">
        <h1 className="text-4xl font-extrabold mb-4 tracking-tighter">Photoselect</h1>
        <p className="text-zinc-500 mb-8 max-w-md text-center text-sm">
          {t.welcomeSubtitle}
        </p>
        <button
          onClick={openFolder}
          className="bg-zinc-900 hover:bg-black text-white px-8 py-4 rounded-xl font-medium transition-all active:scale-95 shadow-lg"
        >
          {t.openPhotoFolder}
        </button>
      </div>
    )
  }

  const currentGroup = imageGroups[currentIndex]
  const folderName = folder.split(/[\\/]/).pop() || folder
  const selectedItems = imageGroups.flatMap((group, index) => group.selected ? [{ group, index }] : [])
  const selectedVisiblePosition = selectedItems.findIndex(item => item.index === currentIndex)
  const visiblePosition = showSelectedOnly ? Math.max(selectedVisiblePosition + 1, 1) : currentIndex + 1
  const visibleTotal = showSelectedOnly ? selectedItems.length : imageGroups.length
  const navigationItems = showSelectedOnly
    ? selectedItems
    : imageGroups.map((group, index) => ({ group, index }))

  const toggleSelectedOnly = () => {
    if (showSelectedOnly) {
      setShowSelectedOnly(false)
      return
    }

    const firstSelected = selectedItems[0]
    if (!firstSelected) return

    if (!currentGroup.selected) {
      setCurrentIndex(firstSelected.index)
    }
    setShowSelectedOnly(true)
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-100 text-zinc-900 overflow-hidden">
      {/* Header */}
      <header className="h-16 bg-white border-b border-zinc-200 flex items-center justify-between px-6 shrink-0 z-10">
        <div className="flex items-center gap-4">
          <button onClick={() => setFolder(null)} className="text-zinc-500 hover:text-black font-medium text-sm transition-colors">
            {t.back}
          </button>
          <div className="h-4 w-px bg-zinc-300"></div>
          <div className="flex flex-col">
            <span className="text-sm font-bold truncate max-w-[200px]" title={folder}>{folderName}</span>
            <span className="text-xs text-zinc-500 font-medium">
              {t.progress(visiblePosition, visibleTotal, showSelectedOnly)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center bg-zinc-100 p-1 rounded-lg">
            <button
              onClick={() => setViewPriority('jpg')}
              className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${viewPriority === 'jpg' ? 'bg-white shadow-sm text-black' : 'text-zinc-500 hover:text-zinc-800'}`}
            >
              {t.jpgFirst}
            </button>
            <button
              onClick={() => setViewPriority('raw')}
              className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${viewPriority === 'raw' ? 'bg-white shadow-sm text-black' : 'text-zinc-500 hover:text-zinc-800'}`}
            >
              {t.rawFirst}
            </button>
          </div>

          <div className="h-4 w-px bg-zinc-300"></div>

          <button
            onClick={toggleSelectedOnly}
            disabled={selectedCount === 0}
            className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${showSelectedOnly
              ? 'bg-black text-white shadow-md'
              : selectedCount > 0
                ? 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 hover:text-black'
                : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
              }`}
          >
            {t.selectedOnly}
          </button>

          <button
            onClick={() => setShowExportModal(true)}
            disabled={selectedCount === 0}
            className={`px-5 py-2 rounded-lg font-bold text-sm transition-all ${selectedCount > 0
              ? 'bg-zinc-900 hover:bg-black text-white shadow-md'
              : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
              }`}
          >
            {t.exportSelected(selectedCount)}
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Main Viewer */}
        <main className="flex-1 relative bg-zinc-100 flex items-center justify-center overflow-hidden p-6">
          {loadingPreview && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-100/50 backdrop-blur-sm z-10">
              <div className="animate-spin rounded-full h-10 w-10 border-4 border-zinc-800 border-t-transparent"></div>
            </div>
          )}

          {currentPreview ? (
            <RotatedImage
              src={currentPreview.url}
              orientation={currentPreview.orientation}
              className="max-w-full max-h-full object-contain rounded-md shadow-md"
            />
          ) : (
            <div className="text-zinc-400 flex flex-col items-center">
              <svg className="w-16 h-16 mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="font-medium">{t.previewUnavailable}</p>
            </div>
          )}

          {/* Overlay Badges */}
          <div className="absolute top-8 left-8 flex flex-col gap-2">
            <div className="bg-black/80 backdrop-blur-md text-white px-3 py-1.5 rounded-md text-sm font-bold shadow-sm">
              {currentGroup.baseName}
            </div>
            <div className="flex gap-1.5">
              {currentGroup.raw && <span className="bg-zinc-600/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-sm tracking-wide">RAW</span>}
              {currentGroup.jpg && <span className="bg-zinc-800/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-sm tracking-wide">JPG</span>}
            </div>
          </div>

          {/* Selection Indicator */}
          <div className="absolute bottom-6 right-6">
            <button
              onClick={() => toggleSelection(currentIndex)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold shadow-md border transition-all active:scale-95 ${currentGroup.selected
                ? 'bg-black border-black text-white'
                : 'bg-white border-zinc-200 text-zinc-400 hover:border-black hover:text-black'
                }`}
            >
              {currentGroup.selected ? (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {t.selected}
                </>
              ) : (
                <>
                  <div className="w-3 h-3 rounded-full border border-current"></div>
                  {t.pick}
                </>
              )}
            </button>
          </div>
        </main>

        <aside className="w-60 bg-white border-l border-zinc-200 shrink-0 flex flex-col">
          <div className="h-14 px-4 border-b border-zinc-200 flex items-center justify-between">
            <div>
              <div className="text-sm font-extrabold text-zinc-900">{t.selectedPhotos}</div>
              <div className="text-xs text-zinc-500">{t.selectedCount(selectedCount)}</div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {selectedItems.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs font-medium text-zinc-400">
                {t.noSelectedPhotos}
              </div>
            ) : (
              selectedItems.map(({ group, index }, selectedIndex) => (
                <button
                  key={group.baseName}
                  onClick={() => setCurrentIndex(index)}
                  className={`w-full text-left px-3 py-2 rounded-md transition-colors ${index === currentIndex
                    ? 'bg-zinc-900 text-white'
                    : 'text-zinc-700 hover:bg-zinc-100'
                    }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs truncate">{group.baseName}</span>
                    <span className={`text-[10px] shrink-0 ${index === currentIndex ? 'text-zinc-300' : 'text-zinc-400'}`}>
                      {selectedIndex + 1}
                    </span>
                  </div>
                  <div className={`mt-1 flex gap-1 text-[10px] font-bold ${index === currentIndex ? 'text-zinc-300' : 'text-zinc-400'}`}>
                    {group.raw && <span>RAW</span>}
                    {group.jpg && <span>JPG</span>}
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>
      </div>

      {/* Filename Navigator */}
      <footer className="h-24 bg-white border-t border-zinc-200 shrink-0 overflow-hidden">
        <div className="h-full overflow-x-auto px-4 py-3 flex items-center gap-2">
          {navigationItems.map(({ group, index }) => (
            <button
              key={group.baseName}
              onClick={() => setCurrentIndex(index)}
              className={`relative w-16 h-16 px-1.5 rounded-md border transition-colors shrink-0 flex items-center justify-center ${
                index === currentIndex
                  ? 'bg-zinc-900 border-zinc-900 text-white'
                  : group.selected
                    ? 'bg-zinc-100 border-zinc-300 text-zinc-900 hover:bg-zinc-200'
                    : 'bg-white border-zinc-200 text-zinc-500 hover:border-zinc-400 hover:text-zinc-900'
              }`}
              title={group.baseName}
            >
              <span className="block text-[10px] leading-tight font-mono text-center break-all line-clamp-3">{group.baseName}</span>
              {group.selected && (
                <span className={`absolute right-1.5 top-1.5 w-1.5 h-1.5 rounded-full ${
                  index === currentIndex ? 'bg-white' : 'bg-zinc-900'
                }`} />
              )}
            </button>
          ))}
        </div>
      </footer>

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-8">
              <h2 className="text-2xl font-extrabold mb-2 tracking-tight">{t.exportTitle}</h2>
              <p className="text-zinc-500 text-sm mb-6">{t.exportDescription(selectedCount)}</p>

              <div className="space-y-3 mb-8">
                <label className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${exportMode === 'both' ? 'border-black bg-zinc-50' : 'border-zinc-200 hover:border-zinc-300'}`}>
                  <input type="radio" name="exportMode" checked={exportMode === 'both'} onChange={() => setExportMode('both')} className="mt-1.5 w-4 h-4 text-black border-zinc-300 focus:ring-black" />
                  <div>
                    <div className="font-bold text-zinc-900">{t.exportBothTitle}</div>
                    <div className="text-xs text-zinc-500 mt-1 leading-relaxed">{t.exportBothDescription}</div>
                  </div>
                </label>

                <label className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${exportMode === 'raw' ? 'border-black bg-zinc-50' : 'border-zinc-200 hover:border-zinc-300'}`}>
                  <input type="radio" name="exportMode" checked={exportMode === 'raw'} onChange={() => setExportMode('raw')} className="mt-1.5 w-4 h-4 text-black border-zinc-300 focus:ring-black" />
                  <div>
                    <div className="font-bold text-zinc-900">{t.exportRawTitle}</div>
                    <div className="text-xs text-zinc-500 mt-1 leading-relaxed">{t.exportRawDescription}</div>
                  </div>
                </label>

                <label className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${exportMode === 'jpg' ? 'border-black bg-zinc-50' : 'border-zinc-200 hover:border-zinc-300'}`}>
                  <input type="radio" name="exportMode" checked={exportMode === 'jpg'} onChange={() => setExportMode('jpg')} className="mt-1.5 w-4 h-4 text-black border-zinc-300 focus:ring-black" />
                  <div>
                    <div className="font-bold text-zinc-900">{t.exportJpgTitle}</div>
                    <div className="text-xs text-zinc-500 mt-1 leading-relaxed">{t.exportJpgDescription}</div>
                  </div>
                </label>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowExportModal(false)}
                  className="flex-1 py-3.5 px-4 rounded-xl font-bold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 hover:text-black transition-colors"
                >
                  {t.cancel}
                </button>
                <button
                  onClick={handleExport}
                  className="flex-1 py-3.5 px-4 rounded-xl font-bold text-white bg-black hover:bg-zinc-800 shadow-lg transition-all active:scale-95"
                >
                  {t.chooseFolderAndCopy}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
