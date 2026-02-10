/// <reference types="vite/client" />

declare module "@cubone/react-file-manager" {
  import type { ComponentType } from "react";

  export type FileManagerFile = {
    name: string;
    isDirectory: boolean;
    path: string;
    updatedAt?: string;
    size?: number;
  };

  export type FileManagerProps = {
    files: FileManagerFile[];
    isLoading?: boolean;
    height?: string | number;
    width?: string | number;
    layout?: "list" | "grid";
    primaryColor?: string;
    fontFamily?: string;
    enableFilePreview?: boolean;
    filePreviewPath?: string;
    filePreviewComponent?: (file: FileManagerFile) => React.ReactNode;
    fileUploadConfig?: { url: string; method?: "POST" | "PUT"; headers?: Record<string, string> };
    initialPath?: string;
    maxFileSize?: number;
    language?: string;
    acceptedFileTypes?: string;
    collapsibleNav?: boolean;
    defaultNavExpanded?: boolean;
    className?: string;
    style?: React.CSSProperties;
    permissions?: {
      create?: boolean;
      upload?: boolean;
      move?: boolean;
      copy?: boolean;
      rename?: boolean;
      download?: boolean;
      delete?: boolean;
    };
    onCreateFolder?: (name: string, parentFolder: FileManagerFile) => void;
    onDelete?: (files: FileManagerFile[]) => void;
    onDownload?: (files: FileManagerFile[]) => void;
    onRename?: (file: FileManagerFile, newName: string) => void;
    onPaste?: (
      files: FileManagerFile[],
      destinationFolder: FileManagerFile,
      operationType: "copy" | "move"
    ) => void;
    onRefresh?: () => void;
    onFileOpen?: (file: FileManagerFile) => void;
    onFolderChange?: (path: string) => void;
    onFileUploaded?: (response: Record<string, unknown>) => void;
    onFileUploading?: (
      file: FileManagerFile,
      parentFolder: FileManagerFile
    ) => Record<string, unknown>;
    onSelectionChange?: (files: FileManagerFile[]) => void;
    onLayoutChange?: (layout: "list" | "grid") => void;
    onError?: (error: { type: string; message: string }, file?: FileManagerFile) => void;
    onCopy?: (files: FileManagerFile[]) => void;
    onCut?: (files: FileManagerFile[]) => void;
    onSortChange?: (sortConfig: { key: string; direction: "asc" | "desc" }) => void;
    formatDate?: (date: string | Date) => string;
  };

  export const FileManager: ComponentType<FileManagerProps>;
}

declare module "@cubone/react-file-manager/dist/style.css";
