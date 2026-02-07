import HomeOutlined from "@mui/icons-material/HomeOutlined";
import { Breadcrumbs, Link, Typography } from "@mui/material";
import { useFileBrowserStore } from "../../../stores/file-browser-store";

export function BreadcrumbNav() {
  const { currentPath, setPath } = useFileBrowserStore();

  const segments = currentPath === "/" ? [] : currentPath.split("/").filter(Boolean);

  const handleClick = (index: number) => {
    const path = `/${segments.slice(0, index + 1).join("/")}`;
    setPath(path);
  };

  return (
    <Breadcrumbs sx={{ mb: 2 }}>
      <Link
        component="button"
        underline="hover"
        color="inherit"
        onClick={() => setPath("/")}
        sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
      >
        <HomeOutlined fontSize="small" />
        Root
      </Link>
      {segments.map((seg, i) =>
        i === segments.length - 1 ? (
          <Typography key={seg} color="text.primary">
            {seg}
          </Typography>
        ) : (
          <Link
            key={seg}
            component="button"
            underline="hover"
            color="inherit"
            onClick={() => handleClick(i)}
          >
            {seg}
          </Link>
        )
      )}
    </Breadcrumbs>
  );
}
