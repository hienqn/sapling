import * as vscode from "vscode";
import { getNonce } from "./getNonce";
import SaplingParser from './parser';
const fs = require('fs');

// Sidebar class that creates a new instance of the sidebar + adds functionality with the parser
export class SidebarProvider implements vscode.WebviewViewProvider {
  _view?: vscode.WebviewView;
  _doc?: vscode.TextDocument;
  parser: SaplingParser | undefined;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  // Instantiate the connection to the webview
  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    // Log to know at what point the webview is initialized
    console.log('WebView Initialized!');

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // Event listener that triggers any moment that the user changes his/her settings preferences
    vscode.workspace.onDidChangeConfiguration((e) => {
      // Get the current settings specifications the user selects
      const settings = vscode.workspace.getConfiguration('sapling');
      // Send a message back to the webview with the data on settings
      webviewView.webview.postMessage({
        type: "settings-data",
        value: settings.view
      });
    });

    // Event listener that triggers whenever the user changes their current active window
    vscode.window.onDidChangeActiveTextEditor((e) => {
      // Catches edge case when the user closes all active tabs
      if (!e) {
        return;
      }
      // Post a message to the webview with the file path of the user's current active window
      webviewView.webview.postMessage({
        type: "current-tab",
        value: e.document.fileName
      });
    });

    // Event listener that triggers whenever the user saves a document
    vscode.workspace.onDidSaveTextDocument((document) => {
      // Edge case that avoids sending messages to the webview when there is no tree currently populated
      if (!this.parser) {
        return;
      }
      // Post a message to the webview with the newly parsed tree
      const parsed = this.parser.updateTree(document.fileName);
      if (webviewView.visible) {
        webviewView.webview.postMessage({
            type: "parsed-data",
            value: parsed
          });
      }
    });

    // Reaches out to the project file connector function below
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Message switch case that will listen for messages sent from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      // Switch cases based on the type sent as a message
      switch (data.type) {
        // Case when the user selects a file to begin a tree
        case "onFile": {
          // Edge case if the user sends in nothing
          if (!data.value) {
            return;
          }
          // Run an instance of the parser
          this.parser = new SaplingParser(data.value);
          const parsed = this.parser.parse();
          // pass the parser result into the value of the postMessage
          webviewView.webview.postMessage({
            type: "parsed-data",
            value: parsed
          });
          break;
        }

        // Case when clicking on tree to open file
        case "onViewFile": {
          if (!data.value) {
            return;
          }
          // Open and the show the user the file they want to see
          const doc = await vscode.workspace.openTextDocument(data.value);
          const editor = await vscode.window.showTextDocument(doc, {preserveFocus: false, preview: false});
          break;
        }

        // Case when sapling becomes visible in sidebar
        case "onSaplingVisible": {
          if (!this.parser) {
            return;
          }
          // Get and send the saved tree to the webview
          const parsed = this.parser.getTree();
          webviewView.webview.postMessage({
            type: "parsed-data",
            value: parsed
          });
          // Get the name of the prev. file saved and send it to the webview
          const shortFileName = this.parser.tree.fileName;
          webviewView.webview.postMessage({
            type: "saved-file",
            value: shortFileName
          });
          break;
        }

        // Case to retrieve the user's settings
        case "onSettingsAcquire": {
          // use getConfiguration to check what the current settings are for the user
          const settings = await vscode.workspace.getConfiguration('sapling');
          // send a message back to the webview with the data on settings
          webviewView.webview.postMessage({
            type: "settings-data",
            value: settings.view
          });
          break;
        }

        // Case that changes the parser's recorded node expanded/collapsed structure
        case "onNodeToggle": {
          // let the parser know that the specific node clicked changed it's expanded value
          this.parser.toggleNode(data.value.id, data.value.expanded);
          break;
        }

        // Message sent to the webview to bold the active file
        case "onBoldCheck": {
          // Message sent to the webview to bold the active file
          const { fileName } = vscode.window.activeTextEditor.document;
          this._view.webview.postMessage({
            type: "current-tab",
            value: fileName
          });
          break;
        }
      }
    });

    // Event that triggers when Webview changes visibility
    webviewView.onDidChangeVisibility((e) => {
    });

    // Event that triggers when Webview is disposed
    webviewView.onDidDispose((e) => {
    });
  }

  // function when the status-bar button is clicked
  public statusButtonClicked = () => {
    // file path of the file the user clicked
    const { fileName } = vscode.window.activeTextEditor.document;
    if (fileName) {
      // begin new instance of the parser
      this.parser = new SaplingParser(fileName);
      this.parser.parse();
      // send the post message to the webview with the new tree
      const parsed = this.parser.getTree();
      this._view.webview.postMessage({
        type: "parsed-data",
        value: parsed
      });
      // Get the name of the prev. file saved and send it to the webview
      const shortFileName = this.parser.tree.fileName;
      this._view.webview.postMessage({
        type: "saved-file",
        value: shortFileName
      });
    }
  };

  // revive statement for the webview panel
  public revive(panel: vscode.WebviewView) {
    this._view = panel;
  }

  // paths and return statement that connects the webview to React project files
  private _getHtmlForWebview(webview: vscode.Webview) {
    const styleResetUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "reset.css")
    );
    const styleVSCodeUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "vscode.css")
    );
    const styleMainUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "styles.css")
    );

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "sidebar.js")
    );

    // Use a nonce to only allow a specific script to be run.
    const nonce = getNonce();

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
        -->
        <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
          style-src 'unsafe-inline' ${webview.cspSource};
          img-src ${webview.cspSource} https:;
          script-src 'nonce-${nonce}';">
          <link href="${styleResetUri}" rel="stylesheet">
          <link href="${styleVSCodeUri}" rel="stylesheet">
          <link href="${styleMainUri}" rel="stylesheet">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script nonce="${nonce}">
          const tsvscode = acquireVsCodeApi();
        </script>
			</head>
      <body>
        <div id="root"></div>
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
  }
}