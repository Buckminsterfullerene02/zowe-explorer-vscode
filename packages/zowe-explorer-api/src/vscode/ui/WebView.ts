/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 *
 */

import * as Handlebars from "handlebars";
import * as fs from "fs";
import HTMLTemplate from "./utils/HTMLTemplate";
import { Types } from "../../Types";
import { Disposable, ExtensionContext, Uri, ViewColumn, WebviewPanel, window } from "vscode";
import { join as joinPath } from "path";
import { randomUUID } from "crypto";

export type WebViewOpts = {
    retainContext: boolean;
};

export class WebView {
    protected disposables: Disposable[];

    // The webview HTML content to render after filling the HTML template.
    protected webviewContent: string;
    protected panel: WebviewPanel;

    // Resource identifiers for the on-disk content and vscode-webview resource.
    private uris: {
        disk?: Types.WebviewUris;
        resource?: Types.WebviewUris;
    } = {};

    // Unique identifier
    private nonce: string;
    protected title: string;

    protected context: ExtensionContext;

    /**
     * Constructs a webview for use with bundled assets.
     * The webview entrypoint must be located at src/<webview folder>/dist/<webview-name>/index.js.
     *
     * @param title The title for the new webview
     * @param webviewName The webview name, the same name given to the directory of your webview in the webviews/src directory.
     * @param context The VSCode extension context
     * @param onDidReceiveMessage Event callback: called when messages are received from the webview
     */
    public constructor(
        title: string,
        webviewName: string,
        context: ExtensionContext,
        onDidReceiveMessage?: (message: object) => void | Promise<void>,
        retainContext?: boolean
    ) {
        this.context = context;
        this.disposables = [];

        // Generate random nonce for loading the bundled script
        this.nonce = randomUUID();
        this.title = title;

        const cssPath = joinPath(context.extensionPath, "src", "webviews", "dist", "style", "style.css");
        const cssExists = fs.existsSync(cssPath);

        // Build URIs for the webview directory and get the paths as VScode resources
        this.uris.disk = {
            build: Uri.file(joinPath(context.extensionPath, "src", "webviews")),
            script: Uri.file(joinPath(context.extensionPath, "src", "webviews", "dist", webviewName, `${webviewName}.js`)),
            css: cssExists ? Uri.file(cssPath) : undefined
        };

        this.panel = window.createWebviewPanel("ZEAPIWebview", this.title, ViewColumn.Beside, {
            enableScripts: true,
            localResourceRoots: [this.uris.disk.build],
            retainContextWhenHidden: retainContext ?? false,
        });

        // Associate URI resources with webview
        this.uris.resource = {
            build: this.panel.webview.asWebviewUri(this.uris.disk.build),
            script: this.panel.webview.asWebviewUri(this.uris.disk.script),
            css: this.uris.disk.css ? this.panel.webview.asWebviewUri(this.uris.disk.css) : undefined
        };

        const template = Handlebars.compile(HTMLTemplate);
        this.webviewContent = template({
            uris: this.uris,
            nonce: this.nonce,
            title: this.title,
        });
        if (onDidReceiveMessage) {
            this.panel.webview.onDidReceiveMessage(async (message) => onDidReceiveMessage(message));
        }
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.html = this.webviewContent;
    }

    /**
     * Disposes of the webview instance
     */
    protected dispose(): void {
        this.panel.dispose();

        for (const disp of this.disposables) {
            disp.dispose();
        }
        this.disposables = [];
        this.panel = undefined;
    }

    /**
     * Pre-processed HTML content that loads the bundled script through the webview.
     */
    public get htmlContent(): string {
        return this.webviewContent;
    }
}
