# Claudio 音乐播放器优化计划

## Phase 1 — 核心播放器功能 (Essential)
1.1 音量控制滑块 — PlayerControls + playerStore + AudioPlayer
1.2 循环/随机模式 — playerStore (repeat/shuffle) + PlayerControls UI
1.3 歌曲搜索 — 后端搜索路由 + SearchPanel组件
1.4 播放错误处理与跳过提示 — toast提示

## Phase 2 — UX 改进 (UX Polish)
2.1 Toast 通知系统 — Toast组件 + toastStore
2.2 键盘快捷键 — useKeyboard hook
2.3 加载状态与骨架屏 — Skeleton组件
2.4 迷你播放器集成 — App.tsx布局

## Phase 3 — 交互增强 (Interaction)
3.1 拖拽排序队列 — QueueList DnD
3.2 媒体会话 API — MediaSession
3.3 播放历史页面 — HistoryPage

## Phase 4 — 锦上添花 (Nice-to-Have)
4.1 歌曲收藏系统 — favorites
4.2 响应式断点优化
