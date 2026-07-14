// Built-in code editor: EditorPane, QuickOpen, and the open-in-editor
// affordances in FilesPanel / ChangesPanel.
const editor = {
	zh: {
		title: '编辑器',
		openInEditor: '在编辑器中打开',
		save: '保存',
		saveAll: '全部保存',
		saved: '已保存',
		closeTab: '关闭标签',
		closePane: '收起编辑器（⌘E）',
		empty: '没有打开的文件',
		emptyHint: '在文件面板点击文件，或按 ⌘P 快速打开',
		unsavedTitle: '未保存的修改',
		unsavedClose: '「{name}」有未保存的修改，关闭将丢弃这些修改。确定关闭？',
		dirtyProjectConfirm: '该项目在编辑器中还有未保存的文件，关闭项目将丢弃这些修改。继续？',
		conflictTitle: '文件已在磁盘上被修改',
		conflictBody: '磁盘上的内容比本编辑器中的更新（可能来自 AI 或其他程序）。',
		overwrite: '覆盖',
		reloadFile: '重新加载',
		aiPending: 'AI 处理中…',
		aiPlaceholder: '描述如何修改选中代码，回车发送（Esc 取消）',
		aiSend: '发送',
		aiSaveSend: '保存并发送',
		aiNoSession: '没有可用的会话',
		quickOpenPlaceholder: '输入文件名，模糊匹配…',
		quickOpenEmpty: '没有匹配的文件',
		utf8: 'UTF-8'
	},
	en: {
		title: 'Editor',
		openInEditor: 'Open in editor',
		save: 'Save',
		saveAll: 'Save all',
		saved: 'Saved',
		closeTab: 'Close tab',
		closePane: 'Hide editor (⌘E)',
		empty: 'No file open',
		emptyHint: 'Click a file in the Files panel, or press ⌘P to quick-open',
		unsavedTitle: 'Unsaved changes',
		unsavedClose: '"{name}" has unsaved changes. Closing will discard them. Close anyway?',
		dirtyProjectConfirm:
			'This project still has unsaved files in the editor; closing it will discard those changes. Continue?',
		conflictTitle: 'File changed on disk',
		conflictBody:
			'The on-disk content is newer than this editor buffer (possibly the AI or another program).',
		overwrite: 'Overwrite',
		reloadFile: 'Reload',
		aiPending: 'AI working…',
		aiPlaceholder: 'Describe how to change the selected code, Enter to send (Esc to cancel)',
		aiSend: 'Send',
		aiSaveSend: 'Save & send',
		aiNoSession: 'No active session',
		quickOpenPlaceholder: 'Type a file name (fuzzy match)…',
		quickOpenEmpty: 'No matching files',
		utf8: 'UTF-8'
	}
};
export default editor;
