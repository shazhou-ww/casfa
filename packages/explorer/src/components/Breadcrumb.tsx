/**
 * <Breadcrumb /> - Path navigation breadcrumb.
 */

import { useCallback, useMemo } from "react";
import { Breadcrumbs, Link, Typography } from "@mui/material";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";
import type { PathSegment } from "../types.ts";

type BreadcrumbProps = {
  renderBreadcrumb?: (segments: PathSegment[]) => React.ReactNode;
};

export function Breadcrumb({ renderBreadcrumb }: BreadcrumbProps) {
  const t = useExplorerT();
  const currentPath = useExplorerStore((s) => s.currentPath);
  const navigate = useExplorerStore((s) => s.navigate);

  const segments = useMemo<PathSegment[]>(() => {
    const result: PathSegment[] = [{ name: t("breadcrumb.root"), path: "" }];
    if (currentPath) {
      const parts = currentPath.split("/");
      let accumulated = "";
      for (const part of parts) {
        accumulated = accumulated ? `${accumulated}/${part}` : part;
        result.push({ name: part, path: accumulated });
      }
    }
    return result;
  }, [currentPath, t]);

  const handleClick = useCallback(
    (path: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      navigate(path);
    },
    [navigate],
  );

  if (renderBreadcrumb) {
    return <>{renderBreadcrumb(segments)}</>;
  }

  return (
    <Breadcrumbs
      separator={<NavigateNextIcon fontSize="small" />}
      sx={{ "& .MuiBreadcrumbs-ol": { flexWrap: "nowrap" } }}
    >
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        if (isLast) {
          return (
            <Typography
              key={seg.path || "__root"}
              variant="body2"
              color="text.primary"
              fontWeight={500}
              noWrap
            >
              {seg.name}
            </Typography>
          );
        }
        return (
          <Link
            key={seg.path || "__root"}
            href="#"
            underline="hover"
            variant="body2"
            color="text.secondary"
            onClick={handleClick(seg.path)}
            noWrap
          >
            {seg.name}
          </Link>
        );
      })}
    </Breadcrumbs>
  );
}
