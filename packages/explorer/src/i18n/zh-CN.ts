/**
 * 简体中文翻译
 */

import type { ExplorerT, ExplorerTextKey } from "../types.ts";

const messages: Record<ExplorerTextKey, string> = {
  // Depot 选择器
  "depot.title": "选择 Depot",
  "depot.empty": "暂无可用 Depot",
  "depot.search": "搜索 Depot…",
  "depot.select": "选择",
  // 工具栏
  "toolbar.refresh": "刷新",
  "toolbar.upload": "上传",
  "toolbar.newFolder": "新建文件夹",
  "toolbar.viewList": "列表视图",
  "toolbar.viewGrid": "网格视图",
  // 面包屑
  "breadcrumb.root": "根目录",
  // 文件列表
  "fileList.name": "名称",
  "fileList.size": "大小",
  "fileList.type": "类型",
  "fileList.empty": "此文件夹为空",
  "fileList.loading": "加载中…",
  "fileList.loadMore": "加载更多…",
  // 右键菜单
  "menu.open": "打开",
  "menu.download": "下载",
  "menu.rename": "重命名",
  "menu.delete": "删除",
  "menu.copy": "复制",
  "menu.cut": "剪切",
  "menu.paste": "粘贴",
  "menu.newFolder": "新建文件夹",
  // 对话框
  "dialog.rename.title": "重命名",
  "dialog.rename.label": "新名称",
  "dialog.delete.title": "删除",
  "dialog.delete.message": "确定要删除「{name}」吗？",
  "dialog.delete.messageMultiple": "确定要删除 {count} 个项目吗？",
  "dialog.newFolder.title": "新建文件夹",
  "dialog.newFolder.label": "文件夹名称",
  "dialog.confirm": "确定",
  "dialog.cancel": "取消",
  // 状态栏
  "status.items": "{count} 个项目",
  "status.selected": "已选择 {count} 项",
  // 错误
  "error.network": "网络错误，请检查连接。",
  "error.authExpired": "会话已过期，请重新登录。",
  "error.permissionDenied": "权限不足。",
  "error.notFound": "未找到。",
  "error.fileTooLarge": "文件过大（最大 4 MB）。",
  "error.nameConflict": "已存在同名文件或文件夹。",
  "error.unknown": "发生未知错误。",
};

/**
 * Create the Chinese (Simplified) translation function.
 */
export const createZhCnT = (): ExplorerT => {
  return (key, params) => {
    let text = messages[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replaceAll(`{${k}}`, String(v));
      }
    }
    return text;
  };
};
