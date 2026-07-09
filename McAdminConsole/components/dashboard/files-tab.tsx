"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Folder,
  FileText,
  FileCode,
  File,
  Link as LinkIcon,
  Search,
  ArrowLeft,
  Upload,
  Plus,
  RefreshCw,
  Download,
  Loader2,
  AlertCircle,
  CheckCircle,
  Save,
  Trash2,
  Copy as CopyIcon,
  Move as MoveIcon,
  Edit as EditIcon,
  FolderOpen,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  listServerFiles,
  getServerFileContent,
  writeServerFileContent,
  uploadServerFile,
  FileEntry,
} from "@/lib/mc-server";

// Helper to format file sizes
function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

// Helper to format timestamps
function formatTime(isoString: string) {
  try {
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return isoString;
  }
}

// Simple Synchronized Line Numbered Textarea component
interface LineNumberedTextAreaProps {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}

function LineNumberedTextArea({ value, onChange, disabled }: LineNumberedTextAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    if (textareaRef.current && linesRef.current) {
      linesRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const lineCount = value.split("\n").length;
  const lineNumbers = Array.from({ length: Math.max(lineCount, 1) }, (_, i) => i + 1);

  return (
    <div className="flex h-[500px] w-full border border-zinc-850 rounded-xl bg-black font-mono text-xs overflow-hidden focus-within:border-zinc-700 transition-colors">
      {/* Line numbers column */}
      <div
        ref={linesRef}
        className="w-12 bg-zinc-900/60 py-3 text-right pr-3 select-none text-zinc-600 border-r border-zinc-900 overflow-y-hidden scrollbar-none"
        style={{ lineHeight: "1.5rem" }}
      >
        {lineNumbers.map((num) => (
          <div key={num} className="h-[1.5rem] pr-0.5 font-semibold text-[10px]">
            {num}
          </div>
        ))}
      </div>

      {/* Textarea editor (wrapping disabled to align line numbers correctly) */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        disabled={disabled}
        wrap="off"
        className="flex-1 bg-transparent py-3 px-4 text-zinc-300 outline-none resize-none overflow-y-auto overflow-x-auto h-full scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent leading-6 whitespace-pre"
        style={{ lineHeight: "1.5rem" }}
        placeholder="Enter file contents here..."
      />
    </div>
  );
}

export default function FilesTab() {
  const [currentPath, setCurrentPath] = useState<string>("/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Editor states
  const [editingFile, setEditingFile] = useState<{
    path: string;
    filename: string;
    content: string;
    size: number;
  } | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveForce, setSaveForce] = useState<boolean>(false);

  // Upload states
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadFileName, setUploadFileName] = useState<string>("");

  // New File dialog states
  const [isCreatingFile, setIsCreatingFile] = useState<boolean>(false);
  const [newFileName, setNewFileName] = useState<string>("");
  const [newFileForce, setNewFileForce] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Notification banners
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 5000);
  };

  // Helper to update the URL query parameters
  const updateUrl = (path: string, editFilename: string | null) => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams();
      params.set("path", path);
      if (editFilename) {
        params.set("edit", editFilename);
      }
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.pushState(null, "", newUrl);
    }
  };

  // Load a file directly (e.g. from URL parameters)
  const loadAndEditFile = async (dirPath: string, filename: string) => {
    setLoading(true);
    setError(null);
    const parentPath = dirPath === "/" ? "" : dirPath;
    const filePath = `${parentPath}/${filename}`;
    try {
      const fileData = await getServerFileContent(filePath);
      setEditingFile({
        path: fileData.path,
        filename: filename,
        content: fileData.content,
        size: fileData.size,
      });
      setSaveForce(false);
    } catch (err) {
      console.error(err);
      setError("Failed to load file for editing: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  };

  // Fetch file list
  const fetchFiles = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listServerFiles(path);
      // Sort: dirs first, then files alphabetically
      const sorted = [...data.entries].sort((a, b) => {
        if (a.type === "dir" && b.type !== "dir") return -1;
        if (a.type !== "dir" && b.type === "dir") return 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(sorted);
      
      // Enforce currentPath matching the normalized requested path
      // to guard against backend response formatting mismatches (e.g. /javax instead of /lib/javax)
      let normalized = path.trim().replace(/\\/g, "/");
      if (!normalized.startsWith("/")) {
        normalized = "/" + normalized;
      }
      if (normalized.length > 1 && normalized.endsWith("/")) {
        normalized = normalized.substring(0, normalized.length - 1);
      }
      setCurrentPath(normalized);
    } catch (err) {
      console.error(err);
      setError("Failed to retrieve directory files. Please verify connection to the server.");
    } finally {
      setLoading(false);
    }
  };

  // Handle URL reading on mount and load initial state
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const pathParam = params.get("path") || "/";
      const editParam = params.get("edit");

      setCurrentPath(pathParam);

      if (editParam) {
        loadAndEditFile(pathParam, editParam);
      } else {
        fetchFiles(pathParam);
      }
    }
  }, []);

  // Listen to popstate for proper back/forward browser navigation
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const pathParam = params.get("path") || "/";
      const editParam = params.get("edit");

      setCurrentPath(pathParam);
      if (editParam) {
        loadAndEditFile(pathParam, editParam);
      } else {
        setEditingFile(null);
        fetchFiles(pathParam);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [currentPath]);

  // Reload current folder
  const handleRefresh = () => {
    fetchFiles(currentPath);
  };

  // URL-synchronized directory traversal navigation helper
  const navigateTo = (folderName: string) => {
    const parentPath = currentPath === "/" ? "" : currentPath;
    const nextPath = `${parentPath}/${folderName}`;
    fetchFiles(nextPath);
    updateUrl(nextPath, null);
  };

  const handleNavigateToPath = (targetPath: string) => {
    fetchFiles(targetPath);
    updateUrl(targetPath, null);
  };

  // Go to parent directory
  const navigateUp = () => {
    if (currentPath === "/") return;
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    const parentPath = "/" + parts.join("/");
    fetchFiles(parentPath);
    updateUrl(parentPath, null);
  };

  // Edit file: loads text file content
  const handleOpenFile = async (entry: FileEntry) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    const parentPath = currentPath === "/" ? "" : currentPath;
    const filePath = `${parentPath}/${entry.name}`;

    try {
      const fileData = await getServerFileContent(filePath);
      setEditingFile({
        path: fileData.path,
        filename: entry.name,
        content: fileData.content,
        size: fileData.size,
      });
      setSaveForce(false);
      updateUrl(currentPath, entry.name);
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Could not open text file.");
    }
  };

  const handleCloseEditor = () => {
    setEditingFile(null);
    updateUrl(currentPath, null);
    fetchFiles(currentPath);
  };

  // Save changes to active file
  const handleSaveFile = async () => {
    if (!editingFile) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await writeServerFileContent(editingFile.path, editingFile.content, saveForce);
      showSuccess(`File '${editingFile.filename}' saved successfully.`);
      // Fetch latest list state
      fetchFiles(currentPath);
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to save file.");
    } finally {
      setSaving(false);
    }
  };

  // Download a text file
  const handleDownloadFile = async (entry: FileEntry) => {
    const parentPath = currentPath === "/" ? "" : currentPath;
    const filePath = `${parentPath}/${entry.name}`;
    try {
      const fileData = await getServerFileContent(filePath);
      const blob = new Blob([fileData.content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = entry.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showSuccess(`Downloading '${entry.name}'`);
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Download failed. Only text files under 5MB can be downloaded.");
    }
  };

  // Trigger file picker for uploads
  const triggerUploadInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  // Upload file selection change handler
  const handleUploadFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    setUploadFileName(file.name);
    setUploading(true);
    setUploadProgress(0);
    setErrorMsg(null);

    const parentPath = currentPath === "/" ? "" : currentPath;
    const destPath = `${parentPath}/${file.name}`;

    try {
      await uploadServerFile(destPath, file, true, (progress) => {
        setUploadProgress(progress);
      });
      showSuccess(`File '${file.name}' uploaded successfully.`);
      fetchFiles(currentPath);
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  // Create new file submit
  const handleCreateFileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;

    const cleanName = newFileName.trim();
    const parentPath = currentPath === "/" ? "" : currentPath;
    const filePath = `${parentPath}/${cleanName}`;

    try {
      await writeServerFileContent(filePath, "", newFileForce);
      setIsCreatingFile(false);
      setNewFileName("");
      setNewFileForce(false);
      showSuccess(`Created new file '${cleanName}'`);
      
      // Fetch new listing and open the file immediately for editing
      await fetchFiles(currentPath);
      setEditingFile({
        path: filePath,
        filename: cleanName,
        content: "",
        size: 0
      });
      updateUrl(currentPath, cleanName);
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to create new file.");
    }
  };

  // Filter listed files/folders
  const filteredEntries = entries.filter((e) =>
    e.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Breadcrumbs builder
  const getBreadcrumbs = () => {
    const parts = currentPath.split("/").filter(Boolean);
    const breadcrumbs = [{ name: "Root", path: "/" }];
    
    let pathAcc = "";
    parts.forEach((p) => {
      pathAcc += "/" + p;
      breadcrumbs.push({ name: p, path: pathAcc });
    });
    
    return breadcrumbs;
  };

  // Icon mapping depending on file type
  const getFileIcon = (entry: FileEntry) => {
    if (entry.type === "dir") {
      return <Folder className="w-4 h-4 text-amber-400 fill-amber-500/20 shrink-0" />;
    }
    if (entry.type === "symlink") {
      return <LinkIcon className="w-4 h-4 text-indigo-400 shrink-0" />;
    }
    
    const ext = entry.name.split(".").pop()?.toLowerCase();
    if (ext === "properties" || ext === "txt" || ext === "log") {
      return <FileText className="w-4 h-4 text-zinc-400 shrink-0" />;
    }
    if (ext === "yml" || ext === "yaml" || ext === "json" || ext === "xml") {
      return <FileCode className="w-4 h-4 text-emerald-400 shrink-0" />;
    }
    return <File className="w-4 h-4 text-zinc-500 shrink-0" />;
  };

  // Render editor view if a file is open
  if (editingFile) {
    return (
      <div className="space-y-4">
        {/* Editor navigation header */}
        <div className="flex items-center justify-between border-b border-zinc-900 pb-4">
          <div className="flex items-center gap-3">
            <Button
              onClick={handleCloseEditor}
              variant="outline"
              size="icon-sm"
              className="rounded-xl border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-white cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h4 className="font-bold text-white text-sm flex items-center gap-2">
                Editing: <span className="font-mono text-xs text-indigo-400">{editingFile.path}</span>
              </h4>
              <p className="text-[10px] text-zinc-500 font-medium">
                Size: {formatBytes(editingFile.size)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Force Overwrite switch */}
            <label className="flex items-center gap-2 cursor-pointer select-none text-[11px] font-bold uppercase tracking-wider font-mono text-zinc-500 hover:text-zinc-400">
              <input
                type="checkbox"
                checked={saveForce}
                onChange={(e) => setSaveForce(e.target.checked)}
                className="rounded border-zinc-800 bg-black text-indigo-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
              />
              Force Overwrite
            </label>

            <Button
              onClick={handleSaveFile}
              disabled={saving}
              className="h-9 px-4 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 cursor-pointer flex items-center gap-1.5 active:scale-[0.98] transition-transform"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save File
            </Button>
          </div>
        </div>

        {/* Notifications */}
        {successMsg && (
          <div className="flex items-center gap-2 p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs font-semibold shadow-[0_0_15px_rgba(16,185,129,0.15)] animate-in fade-in duration-300">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}
        {errorMsg && (
          <div className="flex items-center gap-2 p-3.5 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-400 text-xs font-semibold shadow-[0_0_15px_rgba(244,63,94,0.15)] animate-in fade-in duration-300">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Custom Line Numbered Editor */}
        <LineNumberedTextArea
          value={editingFile.content}
          onChange={(val) => setEditingFile({ ...editingFile, content: val })}
          disabled={saving}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* File input for uploading */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleUploadFileChange}
        className="hidden"
      />

      {/* Notifications */}
      {successMsg && (
        <div className="flex items-center gap-2 p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs font-semibold shadow-[0_0_15px_rgba(16,185,129,0.15)] animate-in fade-in duration-300">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 p-3.5 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-400 text-xs font-semibold shadow-[0_0_15px_rgba(244,63,94,0.15)] animate-in fade-in duration-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* New File Creation Overlay Form */}
      {isCreatingFile && (
        <div className="p-4 rounded-2xl border border-zinc-850 bg-zinc-900/20 backdrop-blur-md space-y-4 animate-in fade-in slide-in-from-top-3 duration-300">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">Create New Text File</h4>
            <Button
              onClick={() => setIsCreatingFile(false)}
              variant="ghost"
              className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer h-7 px-2"
            >
              Cancel
            </Button>
          </div>

          <form onSubmit={handleCreateFileSubmit} className="flex flex-col sm:flex-row gap-3 items-end sm:items-center">
            <div className="flex-1 w-full relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-xs">{currentPath === "/" ? "/" : currentPath + "/"}</span>
              <Input
                type="text"
                required
                placeholder="filename.yml, server.properties, notes.txt"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                className="pl-[60px] bg-black border-zinc-850 rounded-xl text-zinc-200 placeholder-zinc-600 font-mono text-xs h-10 w-full focus-visible:ring-zinc-800"
              />
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <label className="flex items-center gap-1.5 cursor-pointer text-[10px] uppercase font-mono font-bold text-zinc-500 select-none">
                <input
                  type="checkbox"
                  checked={newFileForce}
                  onChange={(e) => setNewFileForce(e.target.checked)}
                  className="rounded border-zinc-800 bg-black text-indigo-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />
                Force
              </label>

              <Button
                type="submit"
                className="h-10 px-4 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Create File
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Uploading progress modal */}
      {uploading && (
        <div className="fixed bottom-6 right-6 z-50 w-80 bg-zinc-950 border border-zinc-850 rounded-2xl p-4 shadow-2xl space-y-3 animate-in slide-in-from-bottom-5 duration-300">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-200 truncate pr-4">Uploading: {uploadFileName}</span>
            <span className="text-[10px] font-bold text-indigo-400 font-mono">{uploadProgress}%</span>
          </div>

          <div className="w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-indigo-500 h-full rounded-full transition-all duration-100 ease-out shadow-[0_0_10px_rgba(99,102,241,0.5)]"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>

          <p className="text-[9px] text-zinc-500 font-medium">Please do not refresh or close the tab</p>
        </div>
      )}

      {/* Merged Search box (all extra space) and Toolbar (shrink-to-fit on the right) */}
      <div className="flex items-center gap-4">
        {/* Search Input taking all extra space */}
        <div className="relative flex-grow">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            type="text"
            placeholder="Filter files in directory..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 py-5 bg-zinc-900/30 border-zinc-850 rounded-xl text-xs placeholder-zinc-500 text-zinc-200 focus-visible:ring-zinc-700 w-full"
          />
        </div>

        {/* Toolbar Buttons taking only needed space */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {currentPath !== "/" && (
            <Button
              onClick={navigateUp}
              variant="outline"
              className="h-9 px-3 rounded-xl text-xs font-semibold border-zinc-850 hover:bg-zinc-900/40 text-zinc-300 cursor-pointer flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Up
            </Button>
          )}

          <Button
            onClick={() => setIsCreatingFile(true)}
            variant="outline"
            className="h-9 px-3 rounded-xl text-xs font-semibold border-zinc-850 hover:bg-zinc-900/40 text-zinc-300 cursor-pointer flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            New File
          </Button>

          <Button
            onClick={triggerUploadInput}
            variant="outline"
            className="h-9 px-3 rounded-xl text-xs font-semibold border-zinc-850 hover:bg-zinc-900/40 text-zinc-300 cursor-pointer flex items-center gap-1"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload
          </Button>

          <Button
            onClick={handleRefresh}
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-xl border-zinc-850 hover:bg-zinc-900/40 text-zinc-300 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Shadcn UI Breadcrumbs Trail (directly beneath the search row with no divider/surfaces) */}
      <div className="flex items-center gap-1.5 flex-wrap px-1">
        <Breadcrumb>
          <BreadcrumbList>
            {getBreadcrumbs().map((b, index) => {
              const isLast = index === getBreadcrumbs().length - 1;
              return (
                <React.Fragment key={b.path}>
                  {index > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage className="font-bold text-white bg-zinc-900 border border-zinc-850 px-2 py-1 rounded-lg text-xs">
                        {b.name}
                      </BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink
                        onClick={() => handleNavigateToPath(b.path)}
                        render={(props) => (
                          <button
                            {...props}
                            type="button"
                            className="cursor-pointer text-xs font-bold text-zinc-500 hover:text-zinc-200 focus:outline-none"
                          />
                        )}
                      >
                        {b.name}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </React.Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Files Grid and Table with Context Menu wrapping */}
      <Card className="border-zinc-850 bg-zinc-900/10 rounded-2xl overflow-hidden mt-2">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="w-8 h-8 text-zinc-500 animate-spin" />
              <span className="text-xs text-zinc-500 font-medium">Scanning directory structure...</span>
            </div>
          ) : error ? (
            <div className="p-6 text-center space-y-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mb-2">
                <AlertCircle className="w-6 h-6" />
              </div>
              <p className="text-xs text-zinc-400">{error}</p>
              <Button
                onClick={handleRefresh}
                className="px-6 h-9 rounded-xl text-xs font-bold bg-zinc-900 hover:bg-zinc-850 text-zinc-200 border border-zinc-800 cursor-pointer"
              >
                Retry
              </Button>
            </div>
          ) : filteredEntries.length > 0 ? (
            <div className="w-full overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs text-zinc-400">
                <thead>
                  <tr className="border-b border-zinc-900 bg-zinc-950/40 text-[10px] font-bold uppercase tracking-wider font-mono text-zinc-500">
                    <th className="py-3 px-6">Name</th>
                    <th className="py-3 px-6">Size</th>
                    <th className="py-3 px-6">Modified Date</th>
                    <th className="py-3 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900/60 font-mono text-zinc-300">
                  {filteredEntries.map((entry) => {
                    const isFolder = entry.type === "dir";
                    const isSymlink = entry.type === "symlink";
                    const isTextFile =
                      !isFolder &&
                      !isSymlink &&
                      (entry.name.endsWith(".properties") ||
                        entry.name.endsWith(".yml") ||
                        entry.name.endsWith(".yaml") ||
                        entry.name.endsWith(".json") ||
                        entry.name.endsWith(".log") ||
                        entry.name.endsWith(".txt"));

                    return (
                      <ContextMenu key={entry.name}>
                        <ContextMenuTrigger
                          render={
                            <tr
                              onClick={() => {
                                if (isFolder) {
                                  navigateTo(entry.name);
                                } else if (isTextFile) {
                                  handleOpenFile(entry);
                                }
                              }}
                              className="hover:bg-zinc-900/20 cursor-pointer transition-colors duration-150 group"
                            />
                          }
                        >
                          {/* File Name */}
                          <td className="py-3 px-6 font-semibold flex items-center gap-2.5 text-zinc-200 max-w-xs sm:max-w-md truncate">
                            {getFileIcon(entry)}
                            <span className={isFolder ? "text-indigo-400 hover:underline" : ""}>
                              {entry.name}
                            </span>
                          </td>

                          {/* File Size */}
                          <td className="py-3 px-6 text-zinc-400">
                            {isFolder ? <span className="text-zinc-600">—</span> : formatBytes(entry.size)}
                          </td>

                          {/* Modified Time */}
                          <td className="py-3 px-6 text-zinc-500">
                            {formatTime(entry.modified)}
                          </td>

                          {/* Actions Column */}
                          <td className="py-3 px-6 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5">
                              {isFolder ? (
                                <Button
                                  onClick={() => navigateTo(entry.name)}
                                  variant="ghost"
                                  size="icon-xs"
                                  className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-zinc-800 text-zinc-400 hover:text-white"
                                >
                                  <FolderOpen className="w-3.5 h-3.5" />
                                </Button>
                              ) : (
                                <>
                                  {isTextFile && (
                                    <Button
                                      onClick={() => handleOpenFile(entry)}
                                      variant="ghost"
                                      size="icon-xs"
                                      className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-zinc-800 text-zinc-400 hover:text-white"
                                    >
                                      <EditIcon className="w-3.5 h-3.5" />
                                    </Button>
                                  )}
                                  <Button
                                    onClick={() => handleDownloadFile(entry)}
                                    variant="ghost"
                                    size="icon-xs"
                                    className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-zinc-800 text-zinc-400 hover:text-white"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </ContextMenuTrigger>

                        {/* Shadcn ContextMenu Options */}
                        <ContextMenuContent className="w-48 border border-zinc-850 bg-zinc-950 p-1 text-zinc-300">
                          {isFolder ? (
                            <>
                              <ContextMenuItem
                                onClick={() => navigateTo(entry.name)}
                                className="cursor-pointer hover:bg-zinc-900 focus:bg-zinc-900 focus:text-white"
                              >
                                <FolderOpen className="w-4 h-4 mr-2 text-zinc-500" />
                                Open Folder
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => triggerUploadInput()}
                                className="cursor-pointer hover:bg-zinc-900 focus:bg-zinc-900 focus:text-white"
                              >
                                <Upload className="w-4 h-4 mr-2 text-zinc-500" />
                                Upload Here
                              </ContextMenuItem>
                            </>
                          ) : (
                            <>
                              <ContextMenuItem
                                onClick={() => isTextFile && handleOpenFile(entry)}
                                disabled={!isTextFile}
                                className="cursor-pointer hover:bg-zinc-900 focus:bg-zinc-900 focus:text-white disabled:pointer-events-none disabled:opacity-40"
                              >
                                <EditIcon className="w-4 h-4 mr-2 text-zinc-500" />
                                Edit File
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => handleDownloadFile(entry)}
                                className="cursor-pointer hover:bg-zinc-900 focus:bg-zinc-900 focus:text-white"
                              >
                                <Download className="w-4 h-4 mr-2 text-zinc-500" />
                                Download
                              </ContextMenuItem>
                            </>
                          )}

                          <ContextMenuSeparator className="bg-zinc-900" />

                          {/* Disabled greyed out options as requested */}
                          <ContextMenuItem disabled className="opacity-40 cursor-not-allowed">
                            <CopyIcon className="w-4 h-4 mr-2" />
                            Copy
                          </ContextMenuItem>
                          <ContextMenuItem disabled className="opacity-40 cursor-not-allowed">
                            <MoveIcon className="w-4 h-4 mr-2" />
                            Move
                          </ContextMenuItem>
                          <ContextMenuItem disabled className="opacity-40 cursor-not-allowed">
                            <EditIcon className="w-4 h-4 mr-2" />
                            Rename
                          </ContextMenuItem>
                          <ContextMenuItem disabled className="opacity-40 cursor-not-allowed text-rose-500">
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-20">
              <FileText className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
              <p className="text-xs text-zinc-500">No matching files found in this directory.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
