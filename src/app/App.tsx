import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from './components/ui/button';
import { Slider } from './components/ui/slider';
import { Label } from './components/ui/label';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import {
  Image, Download, Upload, X, FileImage,
  SlidersHorizontal, Plus, Type,
} from 'lucide-react';
import JSZip from 'jszip';

type WatermarkMode = 'free' | 'repeat';
type OutputFormat  = 'png' | 'jpeg' | 'webp';
type WmSource      = 'image' | 'text';
type RightPanel    = 'settings' | 'images' | null;

interface WatermarkImage { file: File; src: string; width: number; height: number; }
interface TargetImage    { id: string; file: File; src: string; width: number; height: number; }
interface WatermarkSettings {
  mode: WatermarkMode; opacity: number; rotation: number;
  scale: number; x: number; y: number;
  gapX: number; gapY: number; outputFormat: OutputFormat;
}

const FONTS = [
  { value: 'sans-serif', label: 'Sans Serif' },
  { value: 'serif',      label: 'Serif'      },
  { value: 'monospace',  label: 'Monospace'  },
  { value: 'cursive',    label: 'Cursive'    },
  { value: 'fantasy',    label: 'Fantasy'    },
];

export default function App() {
  const [watermark, setWatermark]             = useState<WatermarkImage | null>(null);
  const [targetImages, setTargetImages]       = useState<TargetImage[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds]           = useState<Set<string>>(new Set());
  const [settings, setSettings]               = useState<WatermarkSettings>({
    mode: 'free', opacity: 30, rotation: 0, scale: 8,
    x: 50, y: 50, gapX: 150, gapY: 150, outputFormat: 'png',
  });
  const [isProcessing, setIsProcessing]         = useState(false);
  const [isDragging, setIsDragging]             = useState(false);
  const [isCenterDragOver, setIsCenterDragOver] = useState(false);
  const [wmImgReady, setWmImgReady]             = useState(false);
  const [rightPanel, setRightPanel]             = useState<RightPanel>(null);
  // パネルが完全に閉じきるまでプレースホルダーを非表示にする
  const [panelFullyClosed, setPanelFullyClosed] = useState(true);

  useEffect(() => {
    if (rightPanel) {
      setPanelFullyClosed(false);
    } else {
      const t = setTimeout(() => setPanelFullyClosed(true), 300);
      return () => clearTimeout(t);
    }
  }, [rightPanel]);

  // Text watermark state
  const [wmSource, setWmSource] = useState<WmSource>('image');
  const [wmText,   setWmText]   = useState('Watermark');
  const [wmColor,  setWmColor]  = useState('#ffffff');
  const [wmFont,   setWmFont]   = useState('sans-serif');

  // Refs
  const baseCanvasRef      = useRef<HTMLCanvasElement>(null);
  const wmCanvasRef        = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const watermarkInputRef  = useRef<HTMLInputElement>(null);
  const targetInputRef     = useRef<HTMLInputElement>(null);
  const wmImgRef           = useRef<HTMLImageElement | null>(null);
  const rafRef             = useRef<number | null>(null);
  const settingsRef        = useRef(settings);
  const wmSourceRef        = useRef(wmSource);
  const wmTextRef          = useRef(wmText);
  const wmColorRef         = useRef(wmColor);
  const wmFontRef          = useRef(wmFont);

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { wmSourceRef.current = wmSource;  }, [wmSource]);
  useEffect(() => { wmTextRef.current   = wmText;    }, [wmText]);
  useEffect(() => { wmColorRef.current  = wmColor;   }, [wmColor]);
  useEffect(() => { wmFontRef.current   = wmFont;    }, [wmFont]);

  const selectedImage = targetImages.find(img => img.id === selectedImageId) ?? null;

  const hasWatermark = wmSource === 'image'
    ? (!!watermark && wmImgReady)
    : wmText.trim().length > 0;

  // Load watermark image
  useEffect(() => {
    if (wmSource !== 'image' || !watermark) {
      wmImgRef.current = null;
      setWmImgReady(false);
      const c = wmCanvasRef.current;
      if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
      return;
    }
    setWmImgReady(false);
    const img = new window.Image();
    img.onload = () => { wmImgRef.current = img; setWmImgReady(true); };
    img.src = watermark.src;
  }, [watermark, wmSource]);

  // Render base image
  useEffect(() => {
    const img = selectedImage;
    if (!img) return;
    const baseCanvas = baseCanvasRef.current;
    const wmCanvas   = wmCanvasRef.current;
    if (!baseCanvas || !wmCanvas) return;
    baseCanvas.width  = img.width;  baseCanvas.height  = img.height;
    wmCanvas.width    = img.width;  wmCanvas.height    = img.height;
    const ctx = baseCanvas.getContext('2d');
    if (!ctx) return;
    const baseImg = new window.Image();
    baseImg.onload = () => {
      ctx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
      ctx.drawImage(baseImg, 0, 0);
      if (hasWatermark) scheduleWmRender();
    };
    baseImg.src = img.src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImage?.id]);

  // Re-render overlay
  useEffect(() => {
    if (!hasWatermark || !selectedImage) return;
    scheduleWmRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, hasWatermark, selectedImage?.id, wmText, wmColor, wmFont, wmSource]);

  const scheduleWmRender = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => { renderWmOverlay(); rafRef.current = null; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw watermark onto any ctx
  const drawWatermark = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    overrideImg?: HTMLImageElement | null,
  ) => {
    const s = settingsRef.current;
    ctx.globalAlpha = s.opacity / 100;

    if (wmSourceRef.current === 'text') {
      const text = wmTextRef.current;
      if (!text.trim()) { ctx.globalAlpha = 1; return; }
      const fontSize = Math.max(12, (w * s.scale) / 100);
      ctx.font         = `${fontSize}px ${wmFontRef.current}`;
      ctx.fillStyle    = wmColorRef.current;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      if (s.mode === 'free') {
        ctx.save();
        ctx.translate((w * s.x) / 100, (h * s.y) / 100);
        ctx.rotate((s.rotation * Math.PI) / 180);
        ctx.fillText(text, 0, 0);
        ctx.restore();
      } else {
        const cols = Math.ceil(w / s.gapX) + 1;
        const rows = Math.ceil(h / s.gapY) + 1;
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            ctx.save();
            ctx.translate(c * s.gapX, r * s.gapY);
            ctx.rotate((s.rotation * Math.PI) / 180);
            ctx.fillText(text, 0, 0);
            ctx.restore();
          }
      }
    } else {
      const wmImg = overrideImg !== undefined ? overrideImg : wmImgRef.current;
      if (!wmImg) { ctx.globalAlpha = 1; return; }
      const wmW = (wmImg.naturalWidth  * s.scale) / 100;
      const wmH = (wmImg.naturalHeight * s.scale) / 100;
      if (s.mode === 'free') {
        ctx.save();
        ctx.translate((w * s.x) / 100, (h * s.y) / 100);
        ctx.rotate((s.rotation * Math.PI) / 180);
        ctx.drawImage(wmImg, -wmW / 2, -wmH / 2, wmW, wmH);
        ctx.restore();
      } else {
        const cols = Math.ceil(w / s.gapX) + 1;
        const rows = Math.ceil(h / s.gapY) + 1;
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            ctx.save();
            ctx.translate(c * s.gapX, r * s.gapY);
            ctx.rotate((s.rotation * Math.PI) / 180);
            ctx.drawImage(wmImg, -wmW / 2, -wmH / 2, wmW, wmH);
            ctx.restore();
          }
      }
    }
    ctx.globalAlpha = 1;
  };

  const renderWmOverlay = () => {
    const canvas = wmCanvasRef.current;
    if (!canvas || canvas.width === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); // 残留トランスフォームをリセット
    ctx.globalAlpha = 1;                 // 残留アルファをリセット
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawWatermark(ctx, canvas.width, canvas.height);
  };

  // Canvas drag
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (settings.mode !== 'free' || !selectedImage) return;
    const canvas = wmCanvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const y = (e.clientY - rect.top)  * (canvas.height / rect.height);
    const s = settingsRef.current;
    const cx = (canvas.width  * s.x) / 100;
    const cy = (canvas.height * s.y) / 100;
    let hitW = 200, hitH = 60;
    if (wmSourceRef.current === 'image' && wmImgRef.current) {
      hitW = (wmImgRef.current.naturalWidth  * s.scale) / 100 * 0.65;
      hitH = (wmImgRef.current.naturalHeight * s.scale) / 100 * 0.65;
    }
    if (Math.abs(x - cx) <= hitW && Math.abs(y - cy) <= hitH) setIsDragging(true);
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging || !wmCanvasRef.current) return;
      const canvas = wmCanvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width  / rect.width);
      const y = (e.clientY - rect.top)  * (canvas.height / rect.height);
      setSettings(p => ({
        ...p,
        x: Math.max(0, Math.min(100, (x / canvas.width)  * 100)),
        y: Math.max(0, Math.min(100, (y / canvas.height) * 100)),
      }));
    };
    const onUp = () => setIsDragging(false);
    if (isDragging) {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    }
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
  }, [isDragging]);

  // File utilities
  const loadImage = (file: File): Promise<{ src: string; width: number; height: number }> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new window.Image();
        img.onload  = () => resolve({ src: e.target?.result as string, width: img.width, height: img.height });
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleWatermarkUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const { src, width, height } = await loadImage(files[0]);
      setWatermark({ file: files[0], src, width, height });
      setWmSource('image');
    } catch (err) { console.error(err); }
  };

  const handleTargetUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    const newImages: TargetImage[] = [];
    for (let i = 0; i < files.length; i++) {
      try {
        const { src, width, height } = await loadImage(files[i]);
        newImages.push({ id: `${Date.now()}-${i}`, file: files[i], src, width, height });
      } catch (err) { console.error(err); }
    }
    if (!newImages.length) return;
    setTargetImages(prev => [...prev, ...newImages]);
    setCheckedIds(prev => { const n = new Set(prev); newImages.forEach(img => n.add(img.id)); return n; });
    setSelectedImageId(prev => prev ?? newImages[0].id);
  };

  const removeImage = (id: string) => {
    const remaining = targetImages.filter(i => i.id !== id);
    setTargetImages(remaining);
    setCheckedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    if (selectedImageId === id) setSelectedImageId(remaining[0]?.id ?? null);
  };

  const toggleChecked = (id: string) =>
    setCheckedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Export
  const processImage = (targetImage: TargetImage): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const src = wmSourceRef.current;
      if (src === 'image' && !watermark)                { reject(new Error('No watermark image')); return; }
      if (src === 'text'  && !wmTextRef.current.trim()) { reject(new Error('No watermark text'));  return; }

      const renderOnCanvas = (overrideImg: HTMLImageElement | null) => {
        const canvas = document.createElement('canvas');
        const ctx    = canvas.getContext('2d');
        if (!ctx) { reject(new Error('No ctx')); return; }
        canvas.width  = targetImage.width;
        canvas.height = targetImage.height;
        const targetImg = new window.Image();
        targetImg.onload = () => {
          ctx.drawImage(targetImg, 0, 0);
          drawWatermark(ctx, canvas.width, canvas.height, overrideImg);
          const s   = settingsRef.current;
          const fmt = s.outputFormat === 'jpeg' ? 'image/jpeg' : s.outputFormat === 'webp' ? 'image/webp' : 'image/png';
          canvas.toBlob(
            b => b ? resolve(b) : reject(new Error('toBlob failed')),
            fmt,
            s.outputFormat === 'jpeg' ? 1.0 : undefined,
          );
        };
        targetImg.onerror = reject;
        targetImg.src = targetImage.src;
      };

      if (src === 'text') renderOnCanvas(null);
      else if (wmImgRef.current) renderOnCanvas(wmImgRef.current);
      else if (watermark) {
        const img = new window.Image();
        img.onload  = () => renderOnCanvas(img);
        img.onerror = reject;
        img.src     = watermark.src;
      }
    });

  const handleSaveSingle = async () => {
    if (!selectedImage || !hasWatermark) return;
    setIsProcessing(true);
    try {
      const blob = await processImage(selectedImage);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `${selectedImage.file.name.split('.')[0]}_watermarked.${settings.outputFormat}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error(err); } finally { setIsProcessing(false); }
  };

  const handleSaveAll = async () => {
    const targets = targetImages.filter(img => checkedIds.has(img.id));
    if (!targets.length || !hasWatermark) return;
    setIsProcessing(true);
    const zip = new JSZip();
    try {
      for (const img of targets) {
        const blob = await processImage(img);
        zip.file(`${img.file.name.split('.')[0]}_watermarked.${settings.outputFormat}`, blob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a   = document.createElement('a');
      a.href = url; a.download = 'watermarked_images.zip';
      a.click(); URL.revokeObjectURL(url);
    } catch (err) { console.error(err); } finally { setIsProcessing(false); }
  };

  // Center drag
  const handleCenterDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsCenterDragOver(true); };
  const handleCenterDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsCenterDragOver(false);
  };
  const handleCenterDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsCenterDragOver(false); handleTargetUpload(e.dataTransfer.files);
  };

  const checkedCount = checkedIds.size;
  const allChecked   = targetImages.length > 0 && checkedCount === targetImages.length;

  // Toggle panel (same button closes, different button switches)
  const togglePanel = (panel: 'settings' | 'images') =>
    setRightPanel(prev => prev === panel ? null : panel);

  // Icon button
  const IconBtn = ({
    active, onClick, title, children, badge,
  }: {
    active: boolean; onClick: () => void; title: string;
    children: React.ReactNode; badge?: boolean;
  }) => (
    <button
      title={title}
      onClick={onClick}
      className={`relative w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
        active
          ? 'bg-[#0ea5e9]/20 text-[#0ea5e9]'
          : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
      }`}
    >
      {children}
      {badge && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#0ea5e9]" />}
    </button>
  );

  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="dark size-full flex flex-col bg-[#1e1e1e]">

      {/* Header */}
      <div className="h-14 bg-[#2d2d2d] border-b border-[#3e3e3e] flex items-center px-4 shrink-0">
        <h1 className="text-foreground">WaterMarker</h1>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* ══ CENTER ══════════════════════════════════════════════════ */}
        <div
          className={`flex-1 bg-[#1e1e1e] flex items-center justify-center p-4 relative overflow-hidden${!selectedImage ? ' cursor-pointer' : ''}`}
          onDragOver={handleCenterDragOver}
          onDragEnter={handleCenterDragOver}
          onDragLeave={handleCenterDragLeave}
          onDrop={handleCenterDrop}
          onClick={() => { if (!selectedImage) targetInputRef.current?.click(); }}
        >
          {isCenterDragOver && (
            <div className="absolute inset-2 border-4 border-dashed border-[#0ea5e9] bg-[#0ea5e9]/10 z-50 flex flex-col items-center justify-center rounded-xl pointer-events-none">
              <FileImage className="w-12 h-12 text-[#0ea5e9] mb-2" />
              <p className="text-[#0ea5e9] text-sm">ここにドロップして対象画像を追加</p>
            </div>
          )}

          {selectedImage ? (
            <div
              ref={canvasContainerRef}
              className="relative"
              style={{ display: 'inline-block', maxWidth: '100%', maxHeight: '100%' }}
            >
              <canvas
                ref={baseCanvasRef}
                className="block border border-[#3e3e3e] shadow-2xl"
                style={{
                  imageRendering: 'high-quality',
                  maxWidth: '100%',
                  maxHeight: 'calc(100vh - 56px - 56px - 2rem)',
                }}
              />
              <canvas
                ref={wmCanvasRef}
                className="absolute top-0 left-0"
                style={{
                  width: '100%', height: '100%',
                  imageRendering: 'high-quality',
                  cursor: settings.mode === 'free' ? (isDragging ? 'grabbing' : 'grab') : 'default',
                }}
                onMouseDown={handleCanvasMouseDown}
              />
            </div>
          ) : (
            panelFullyClosed && (
              <div className="text-center text-muted-foreground select-none">
                <Image className="w-14 h-14 mx-auto mb-3 opacity-20" />
                <p className="text-sm">タップして対象画像を追加</p>
                <p className="text-xs mt-1 opacity-50">またはドラッグ＆ドロップ</p>
              </div>
            )
          )}
        </div>

        {/* ══ BOTTOM SHEET ════════════════════════════════════════════ */}
        <div
          className="overflow-hidden transition-all duration-300 bg-[#252525] border-t border-[#3e3e3e] shrink-0"
          style={{ maxHeight: rightPanel ? '60vh' : '0px' }}
        >
          {/* Handle */}
          <div className="flex justify-center pt-2 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-[#3e3e3e]" />
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: 'calc(60vh - 20px)' }}>

            {/* ── Settings panel ─────────────────────────────────── */}
            {rightPanel === 'settings' && (
              <div className="p-4 space-y-5">

                {/* ウォーターマーク */}
                <div className="space-y-3">
                  <Label className="text-xs text-muted-foreground block">ウォーターマーク</Label>

                  <Tabs value={wmSource} onValueChange={v => setWmSource(v as WmSource)}>
                    <TabsList className="w-full">
                      <TabsTrigger value="image" className="flex-1 flex items-center gap-1 text-xs">
                        <Upload className="w-3 h-3" />画像
                      </TabsTrigger>
                      <TabsTrigger value="text" className="flex-1 flex items-center gap-1 text-xs">
                        <Type className="w-3 h-3" />テキスト
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>

                  {wmSource === 'image' && (
                    <>
                      <div
                        className="border-2 border-dashed border-[#3e3e3e] rounded-lg p-4 text-center cursor-pointer hover:border-[#0ea5e9] transition-colors overflow-hidden"
                        onDrop={e => { e.preventDefault(); handleWatermarkUpload(e.dataTransfer.files); }}
                        onDragOver={e => e.preventDefault()}
                        onClick={() => watermarkInputRef.current?.click()}
                      >
                        {watermark ? (
                          <div className="relative">
                            <img
                              src={watermark.src}
                              alt="Watermark"
                              className="w-full h-20 object-contain transition-all"
                              style={{
                                opacity: settings.opacity / 100,
                                transform: `rotate(${settings.rotation}deg)`,
                              }}
                            />
                            <button
                              className="absolute top-0 right-0 bg-red-500 rounded-full p-1"
                              onClick={e => { e.stopPropagation(); setWatermark(null); }}
                            >
                              <X className="w-3 h-3 text-white" />
                            </button>
                          </div>
                        ) : (
                          <div className="text-muted-foreground text-xs">
                            <Upload className="w-6 h-6 mx-auto mb-1" />
                            <p>クリックまたはドロップ</p>
                          </div>
                        )}
                      </div>
                      <input
                        ref={watermarkInputRef}
                        type="file"
                        accept="image/png,image/svg+xml,image/webp"
                        className="hidden"
                        onChange={e => handleWatermarkUpload(e.target.files)}
                      />
                    </>
                  )}

                  {wmSource === 'text' && (
                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">テキスト</Label>
                        <input
                          type="text"
                          value={wmText}
                          onChange={e => setWmText(e.target.value)}
                          placeholder="Watermark"
                          className="w-full bg-[#1e1e1e] border border-[#3e3e3e] rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-[#0ea5e9] transition-colors"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block">フォント</Label>
                          <Select value={wmFont} onValueChange={setWmFont}>
                            <SelectTrigger className="text-white h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {FONTS.map(f => (
                                <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                                  {f.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block">文字色</Label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={wmColor}
                              onChange={e => setWmColor(e.target.value)}
                              className="w-8 h-8 rounded cursor-pointer bg-transparent border border-[#3e3e3e] p-0.5"
                            />
                            <span className="text-xs text-foreground font-mono">{wmColor.toUpperCase()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-lg bg-[#1e1e1e] border border-[#3e3e3e] p-3 flex items-center justify-center min-h-[52px] overflow-hidden">
                        <span
                          style={{
                            fontFamily: wmFont,
                            color: wmColor,
                            fontSize: '18px',
                            opacity: settings.opacity / 100,
                            transform: `rotate(${settings.rotation}deg)`,
                            display: 'inline-block',
                          }}
                        >
                          {wmText || 'プレビュー'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t border-[#3e3e3e]" />

                {/* 配置モード */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">配置モード</Label>
                  <Tabs value={settings.mode} onValueChange={v => setSettings(p => ({ ...p, mode: v as WatermarkMode }))}>
                    <TabsList className="w-full">
                      <TabsTrigger value="free"   className="flex-1">自由配置</TabsTrigger>
                      <TabsTrigger value="repeat" className="flex-1">繰り返し</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                <div className="border-t border-[#3e3e3e]" />

                {/* スライダー群 - 2列グリッド */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                  <div>
                    <div className="flex justify-between mb-2">
                      <Label className="text-xs text-muted-foreground">透明度</Label>
                      <span className="text-xs text-foreground">{Math.round(settings.opacity)}%</span>
                    </div>
                    <Slider value={[settings.opacity]} onValueChange={([v]) => setSettings(p => ({ ...p, opacity: Math.abs(v - 50) <= 2 ? 50 : v }))} min={0} max={100} step={1} />
                  </div>
                  <div>
                    <div className="flex justify-between mb-2">
                      <Label className="text-xs text-muted-foreground">角度</Label>
                      <span className="text-xs text-foreground">{settings.rotation}°</span>
                    </div>
                    <Slider value={[settings.rotation]} onValueChange={([v]) => setSettings(p => ({ ...p, rotation: Math.abs(v) <= 2 ? 0 : v }))} min={-180} max={180} step={1} />
                  </div>
                  <div>
                    <div className="flex justify-between mb-2">
                      <Label className="text-xs text-muted-foreground">サイズ</Label>
                      <span className="text-xs text-foreground">{settings.scale}%</span>
                    </div>
                    <Slider value={[settings.scale]} onValueChange={([v]) => setSettings(p => ({ ...p, scale: v }))} min={5} max={100} step={1} />
                  </div>

                  {settings.mode === 'free' ? (
                    <>
                      <div>
                        <div className="flex justify-between mb-2">
                          <Label className="text-xs text-muted-foreground">位置 X</Label>
                          <span className="text-xs text-foreground">{Math.round(settings.x)}%</span>
                        </div>
                        <Slider value={[settings.x]} onValueChange={([v]) => setSettings(p => ({ ...p, x: v }))} min={0} max={100} step={0.5} />
                      </div>
                      <div>
                        <div className="flex justify-between mb-2">
                          <Label className="text-xs text-muted-foreground">位置 Y</Label>
                          <span className="text-xs text-foreground">{Math.round(settings.y)}%</span>
                        </div>
                        <Slider value={[settings.y]} onValueChange={([v]) => setSettings(p => ({ ...p, y: v }))} min={0} max={100} step={0.5} />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <div className="flex justify-between mb-2">
                          <Label className="text-xs text-muted-foreground">間隔 X</Label>
                          <span className="text-xs text-foreground">{settings.gapX}px</span>
                        </div>
                        <Slider value={[settings.gapX]} onValueChange={([v]) => setSettings(p => ({ ...p, gapX: v }))} min={50} max={500} step={10} />
                      </div>
                      <div>
                        <div className="flex justify-between mb-2">
                          <Label className="text-xs text-muted-foreground">間隔 Y</Label>
                          <span className="text-xs text-foreground">{settings.gapY}px</span>
                        </div>
                        <Slider value={[settings.gapY]} onValueChange={([v]) => setSettings(p => ({ ...p, gapY: v }))} min={50} max={500} step={10} />
                      </div>
                    </>
                  )}
                </div>

                <div className="border-t border-[#3e3e3e]" />

                {/* 出力形式 + 保存ボタン */}
                <div className="grid grid-cols-2 gap-3 items-end">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">出力形式</Label>
                    <Select value={settings.outputFormat} onValueChange={v => setSettings(p => ({ ...p, outputFormat: v as OutputFormat }))}>
                      <SelectTrigger className="text-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="png">PNG（可逆）</SelectItem>
                        <SelectItem value="jpeg">JPEG（品質100）</SelectItem>
                        <SelectItem value="webp">WebP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    className="w-full bg-[#0ea5e9] hover:bg-[#0284c7]"
                    onClick={handleSaveSingle}
                    disabled={!selectedImage || !hasWatermark || isProcessing}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    保存
                  </Button>
                </div>

                {checkedCount > 1 && (
                  <Button className="w-full" variant="outline" onClick={handleSaveAll} disabled={!hasWatermark || isProcessing}>
                    <Download className="w-4 h-4 mr-2" />
                    選択画像を一括保存 ({checkedCount}枚)
                  </Button>
                )}
              </div>
            )}

            {/* ── Images panel ────────────────────────────────────── */}
            {rightPanel === 'images' && (
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-xs text-muted-foreground">
                    対象画像 ({checkedCount}/{targetImages.length})
                  </Label>
                  <div className="flex items-center gap-2">
                    <button
                      title="画像を追加"
                      onClick={() => targetInputRef.current?.click()}
                      className="w-6 h-6 rounded flex items-center justify-center bg-[#0ea5e9] hover:bg-[#0284c7] text-white transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    {targetImages.length > 0 && (
                      <button
                        className="text-[10px] text-[#0ea5e9] hover:underline"
                        onClick={() =>
                          allChecked
                            ? setCheckedIds(new Set())
                            : setCheckedIds(new Set(targetImages.map(i => i.id)))
                        }
                      >
                        {allChecked ? '全解除' : '全選択'}
                      </button>
                    )}
                  </div>
                </div>

                {targetImages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                    <FileImage className="w-10 h-10 mb-2 opacity-30" />
                    <p className="text-xs text-center">中央エリアに画像をドロップ<br />またはＰＬＵＳボタンで追加</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {targetImages.map(img => (
                      <div
                        key={img.id}
                        className={`relative rounded overflow-hidden cursor-pointer border-2 transition-colors aspect-square ${
                          selectedImageId === img.id
                            ? 'border-[#0ea5e9]'
                            : 'border-transparent hover:border-[#3e3e3e]'
                        }`}
                        onClick={() => setSelectedImageId(img.id)}
                      >
                        <img src={img.src} alt={img.file.name} className="w-full h-full object-cover" />
                        <div
                          className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                            checkedIds.has(img.id) ? 'bg-[#0ea5e9] border-[#0ea5e9]' : 'bg-black/50 border-white/50'
                          }`}
                          onClick={e => { e.stopPropagation(); toggleChecked(img.id); }}
                        >
                          {checkedIds.has(img.id) && (
                            <svg viewBox="0 0 10 8" className="w-2 h-1.5" fill="none">
                              <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        <button
                          className="absolute top-0.5 right-0.5 bg-red-500 rounded-full p-0.5"
                          onClick={e => { e.stopPropagation(); removeImage(img.id); }}
                        >
                          <X className="w-2 h-2 text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {checkedCount > 1 && (
                  <div className="mt-4 pt-3 border-t border-[#3e3e3e]">
                    <Button className="w-full" variant="outline" onClick={handleSaveAll} disabled={!hasWatermark || isProcessing}>
                      <Download className="w-4 h-4 mr-2" />
                      選択画像を一括保存 ({checkedCount}枚)
                    </Button>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

        {/* ══ BOTTOM TAB BAR ══════════════════════════════════════════ */}
        <div className="h-14 bg-[#252525] border-t border-[#3e3e3e] flex items-center justify-around shrink-0 px-8">
          <IconBtn
            active={rightPanel === 'settings'}
            onClick={() => togglePanel('settings')}
            title="設定"
          >
            <div className="flex flex-col items-center gap-0.5">
              <SlidersHorizontal className="w-5 h-5" />
              <span className="text-[10px]">設定</span>
            </div>
          </IconBtn>
          <IconBtn
            active={rightPanel === 'images'}
            onClick={() => togglePanel('images')}
            title="対象画像一覧"
            badge={targetImages.length > 0}
          >
            <div className="flex flex-col items-center gap-0.5">
              <FileImage className="w-5 h-5" />
              <span className="text-[10px]">画像一覧</span>
            </div>
          </IconBtn>
        </div>

        {/* Hidden file inputs */}
        <input
          ref={targetInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={e => handleTargetUpload(e.target.files)}
        />
      </div>
    </div>
  );
}