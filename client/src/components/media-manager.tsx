import { useState, useRef } from "react";
import { Upload, Link, Image as ImageIcon, Video, X, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion } from "framer-motion";

interface MediaManagerProps {
  currentUrl: string;
  type: "image" | "video";
  onSave: (url: string) => void;
  onClose: () => void;
}

export function MediaManager({ currentUrl, type, onSave, onClose }: MediaManagerProps) {
  const [activeTab, setActiveTab] = useState("upload");
  const [previewUrl, setPreviewUrl] = useState(currentUrl);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);

    setTimeout(() => {
      const fakeUploadedUrl = URL.createObjectURL(file);
      setPreviewUrl(fakeUploadedUrl);
      setIsUploading(false);
    }, 1500);
  };

  const handleSave = () => {
    onSave(previewUrl);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" data-testid="media-manager-overlay">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-neutral-900 border border-white/10 w-full max-w-md rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="p-4 border-b border-white/10 flex justify-between items-center">
          <h3 className="font-bold text-white flex items-center gap-2">
            {type === 'image' ? <ImageIcon className="text-purple-400" /> : <Video className="text-blue-400" />}
            Edit {type === 'image' ? 'Photo' : 'Video'}
          </h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-white" data-testid="button-close-media">
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 mb-6 bg-neutral-800">
              <TabsTrigger value="upload" data-testid="tab-upload">Upload File</TabsTrigger>
              <TabsTrigger value="link" data-testid="tab-link">External Link</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-white/20 rounded-xl p-8 flex flex-col items-center justify-center text-neutral-400 hover:bg-white/5 hover:border-indigo-500 cursor-pointer transition-all"
                data-testid="upload-dropzone"
              >
                {isUploading ? (
                  <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
                ) : (
                  <Upload className="h-10 w-10 mb-2" />
                )}
                <p className="text-sm font-medium">Click to select {type}</p>
                <p className="text-xs opacity-50 mt-1">Max size: 50MB</p>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept={type === 'image' ? "image/*" : "video/*"}
                  onChange={handleFileUpload}
                  data-testid="input-file-upload"
                />
              </div>
            </TabsContent>

            <TabsContent value="link" className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-neutral-400">Paste URL (YouTube, Vimeo, etc)</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Link className="absolute left-3 top-2.5 h-4 w-4 text-neutral-500" />
                    <Input
                      value={previewUrl}
                      onChange={(e) => setPreviewUrl(e.target.value)}
                      className="pl-9 bg-neutral-800 border-white/10"
                      placeholder="https://..."
                      data-testid="input-media-url"
                    />
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <div className="mt-6 aspect-video bg-black rounded-lg overflow-hidden border border-white/10 relative group" data-testid="media-preview">
            {type === 'image' ? (
              <img src={previewUrl} className="w-full h-full object-cover" alt="Preview" />
            ) : (
              <video src={previewUrl} className="w-full h-full object-cover" autoPlay loop muted playsInline />
            )}
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <p className="text-xs font-mono text-white">PREVIEW</p>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-white/10 flex justify-end gap-2 bg-neutral-900">
          <Button variant="ghost" onClick={onClose} className="text-neutral-400 hover:text-white" data-testid="button-cancel-media">Cancel</Button>
          <Button onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-500 text-white" data-testid="button-save-media">
            <Check size={16} className="mr-2" /> Save Changes
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
