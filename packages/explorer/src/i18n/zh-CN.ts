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
  "depot.create": "新建 Depot",
  "depot.createTitle": "创建 Depot",
  "depot.createLabel": "Depot 标题（可选）",
  "depot.delete": "删除 Depot",
  "depot.deleteConfirm": "确定要删除 Depot「{name}」吗？此操作不可撤销。",
  "depot.deleteSuccess": "Depot 已删除",
  "depot.untitled": "未命名 Depot",
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
  // 上传进度
  "upload.dropHere": "拖放文件到此处上传",
  "upload.uploading": "正在上传 {current}/{total}",
  "upload.progress": "上传中…",
  "upload.done": "上传完成",
  "upload.error": "上传失败",
  "upload.cancel": "取消",
  "upload.retry": "重试",
  "upload.fileTooLarge": "「{name}」文件过大（最大 4 MB），已跳过",
  // 错误
  "error.network": "网络错误，请检查连接。",
  "error.authExpired": "会话已过期，请重新登录。",
  "error.permissionDenied": "权限不足。",
  "error.notFound": "未找到。",
  "error.fileTooLarge": "文件过大（最大 4 MB）。",
  "error.nameConflict": "已存在同名文件或文件夹。",
  "error.unknown": "发生未知错误。",
  // 权限
  "permission.denied": "权限不足",
  // 删除结果
  "delete.success": "删除成功",
  "delete.partial": "成功 {success} 项，失败 {failed} 项",
  // 校验
  "validation.nameEmpty": "名称不能为空",
  "validation.nameInvalid": "名称包含非法字符",
  "validation.nameExists": "已存在同名文件或文件夹",
  // 导航 (Iter 3)
  "nav.back": "后退",
  "nav.forward": "前进",
  "nav.up": "上一级",
  // 搜索 (Iter 3)
  "search.placeholder": "筛选文件…",
  "search.noResults": "未找到匹配项",
  // 路径输入 (Iter 3)
  "pathInput.placeholder": "输入路径…",
  "pathInput.invalid": "路径无效",
  // 侧边栏 (Iter 3)
  "sidebar.collapse": "折叠侧边栏",
  "sidebar.expand": "展开侧边栏",
  // 树 — Depot 集成
  "tree.depots": "Depots",
  "tree.selectDepot": "选择一个 Depot 以浏览文件",
  // 剪贴板 (Iter 4)
  "clipboard.copied": "已复制 {count} 个项目",
  "clipboard.cut": "已剪切 {count} 个项目",
  "clipboard.pasted": "粘贴成功",
  "clipboard.pasteError": "粘贴失败",
  // 详情面板 (Iter 4)
  "detail.title": "详情",
  "detail.name": "名称",
  "detail.path": "路径",
  "detail.size": "大小",
  "detail.type": "类型",
  "detail.nodeKey": "节点密钥",
  "detail.childCount": "子项数",
  "detail.noSelection": "未选择项目",
  "detail.multipleSelected": "已选择 {count} 个项目",
  "detail.totalSize": "总大小",
  // 预览 (Iter 4)
  "preview.title": "预览",
  "preview.unsupported": "此文件类型不支持预览",
  "preview.loading": "正在加载预览\u2026",
  "preview.error": "加载预览失败",
  "preview.tooLarge": "文件过大，无法预览",
  "preview.open": "打开",
  "preview.lines": "{count} 行",
  // 冲突 (Iter 4)
  "conflict.title": "文件冲突",
  "conflict.message": "目标位置已存在名为「{name}」的文件",
  "conflict.overwrite": "覆盖",
  "conflict.skip": "跳过",
  "conflict.rename": "保留两者（重命名）",
  "conflict.applyToAll": "应用到所有冲突",
  "conflict.source": "源文件",
  "conflict.existing": "已有文件",
  // 拖放 (Iter 4)
  "dnd.moveItems": "移动 {count} 个项目",
  "dnd.copyItems": "复制 {count} 个项目",
  // 上传增强 (Iter 4)
  "upload.cancelAll": "取消全部",
  "upload.overallProgress": "总体进度",
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
