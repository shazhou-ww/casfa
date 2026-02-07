import CodeOutlined from "@mui/icons-material/CodeOutlined";
import DescriptionOutlined from "@mui/icons-material/DescriptionOutlined";
import FolderOutlined from "@mui/icons-material/FolderOutlined";
import ImageOutlined from "@mui/icons-material/ImageOutlined";
import InsertDriveFileOutlined from "@mui/icons-material/InsertDriveFileOutlined";
import PictureAsPdfOutlined from "@mui/icons-material/PictureAsPdfOutlined";
import type { SxProps, Theme } from "@mui/material";

type FileIconProps = {
  type: "file" | "directory";
  contentType?: string;
  name?: string;
  sx?: SxProps<Theme>;
};

function getFileIcon(contentType?: string, name?: string) {
  if (contentType?.startsWith("image/")) return ImageOutlined;
  if (contentType === "application/pdf") return PictureAsPdfOutlined;
  if (contentType?.startsWith("text/")) return DescriptionOutlined;

  const ext = name?.split(".").pop()?.toLowerCase();
  if (ext && ["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "cpp", "h"].includes(ext)) {
    return CodeOutlined;
  }
  if (ext && ["md", "txt", "csv", "json", "yaml", "yml", "toml", "xml"].includes(ext)) {
    return DescriptionOutlined;
  }
  return InsertDriveFileOutlined;
}

export function FileIcon({ type, contentType, name, sx }: FileIconProps) {
  if (type === "directory") {
    return <FolderOutlined sx={{ color: "primary.main", ...sx }} />;
  }
  const Icon = getFileIcon(contentType, name);
  return <Icon sx={{ color: "text.secondary", ...sx }} />;
}
