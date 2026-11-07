import * as vscode from 'vscode';
import { SchemaModel } from './core/schema';

const DOWNLOADED_FILE = 'oh-my-posh.schema.json';

/**
 * 同梱のスキーマを既定にし、更新コマンドでダウンロードしたものがあればそちらを使う。
 * 起動のたびに通信しないよう、自動では取りに行かない。
 */
export class SchemaStore {
  private model: SchemaModel | undefined;
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async get(): Promise<SchemaModel> {
    if (!this.model) this.model = await this.load();
    return this.model;
  }

  private async load(): Promise<SchemaModel> {
    const downloaded = vscode.Uri.joinPath(this.context.globalStorageUri, DOWNLOADED_FILE);
    try {
      const bytes = await vscode.workspace.fs.readFile(downloaded);
      return new SchemaModel(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (e) {
      if (!(e instanceof vscode.FileSystemError && e.code === 'FileNotFound')) {
        console.warn('[oh-my-posh] ダウンロード済みのスキーマを読めなかったため、同梱版を使います。', e);
      }
    }
    const bundled = vscode.Uri.joinPath(this.context.extensionUri, 'schemas', DOWNLOADED_FILE);
    const bytes = await vscode.workspace.fs.readFile(bundled);
    return new SchemaModel(JSON.parse(new TextDecoder().decode(bytes)));
  }

  async update(): Promise<void> {
    const url = vscode.workspace.getConfiguration('ohMyPosh').get<string>('schema.url');
    if (!url) {
      void vscode.window.showErrorMessage('ohMyPosh.schema.url が設定されていません。');
      return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Oh My Posh のスキーマを取得しています…' },
      async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
          const text = await res.text();
          // 壊れたスキーマを保存しないよう、コンパイルできることを確かめてから書き込む
          const model = new SchemaModel(JSON.parse(text));
          await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
          await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(this.context.globalStorageUri, DOWNLOADED_FILE), new TextEncoder().encode(text));
          this.model = model;
          this.onDidChangeEmitter.fire();
          void vscode.window.showInformationMessage('Oh My Posh のスキーマを更新しました。');
        } catch (e) {
          void vscode.window.showErrorMessage(`スキーマを更新できませんでした。${e instanceof Error ? e.message : String(e)}`);
        }
      },
    );
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}
