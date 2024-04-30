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

import { ExtensionContext, TreeItemCollapsibleState } from "vscode";
import { AttributeView } from "../../../src/uss/AttributeView";
import { IZoweTree, IZoweUSSTreeNode, MainframeInteraction } from "@zowe/zowe-explorer-api";
import { ZoweExplorerApiRegister } from "../../../src/ZoweExplorerApiRegister";
import { ZoweUSSNode } from "../../../src/uss/ZoweUSSNode";
import * as contextually from "../../../src/shared/context";
import { UssFSProvider } from "../../../src/uss/UssFSProvider";
import { MockedProperty } from "../../../__mocks__/mockUtils";

describe("AttributeView unit tests", () => {
    let view: AttributeView;
    const context = { extensionPath: "some/fake/ext/path" } as unknown as ExtensionContext;
    const treeProvider = { refreshElement: jest.fn(), refresh: jest.fn() } as unknown as IZoweTree<IZoweUSSTreeNode>;
    const createDirMock = jest.spyOn(UssFSProvider.instance, "createDirectory").mockImplementation();
    const node = new ZoweUSSNode({
        label: "example_node",
        collapsibleState: TreeItemCollapsibleState.None,
        parentPath: "/z/some",
    });
    const updateAttrsApiMock = jest.fn();
    const updateAttributesMock = jest.spyOn(node, "setAttributes").mockImplementation();
    const onUpdateMock = jest.fn();
    const onUpdateMocked = new MockedProperty(ZoweUSSNode.prototype, "onUpdate", undefined, onUpdateMock);

    beforeAll(() => {
        jest.spyOn(ZoweExplorerApiRegister, "getUssApi").mockReturnValue({
            updateAttributes: jest.fn(),
            getTag: () => Promise.resolve("UTF-8"),
        } as unknown as MainframeInteraction.IUss);
        jest.spyOn(contextually, "isUssDirectory").mockReturnValue(false);
        view = new AttributeView(context, treeProvider, node);
    });

    afterAll(() => {
        createDirMock.mockRestore();
        onUpdateMocked[Symbol.dispose]();
    });

    it("refreshes properly when webview sends 'refresh' command", async () => {
        // case 1: node is a root node
        await (view as any).onDidReceiveMessage({ command: "refresh" });
        expect(treeProvider.refresh).toHaveBeenCalled();

        // case 2: node is a child node
        node.getParent = jest.fn().mockReturnValueOnce({ label: "parent node" } as IZoweUSSTreeNode);
        await (view as any).onDidReceiveMessage({ command: "refresh" });
        expect(treeProvider.refreshElement).toHaveBeenCalled();

        expect(node.onUpdate).toHaveBeenCalledTimes(2);
    });

    it("dispatches node data to webview when 'ready' command is received", async () => {
        const attrs = {
            group: "group",
            perms: "-rwxrwxrwx",
        };
        const getAttributesMock = jest.spyOn(ZoweUSSNode.prototype, "getAttributes").mockResolvedValue(attrs as any);
        await (view as any).onDidReceiveMessage({ command: "ready" });
        expect(view.panel.webview.postMessage).toHaveBeenCalledWith({
            attributes: attrs,
            name: node.fullPath,
            readonly: false,
        });
        getAttributesMock.mockRestore();
    });

    it("updates attributes when 'update-attributes' command is received", async () => {
        const getAttributesMock = jest.spyOn(ZoweUSSNode.prototype, "getAttributes");
        // case 1: no attributes provided from webview (sanity check)
        updateAttrsApiMock.mockClear();
        await (view as any).onDidReceiveMessage({ command: "update-attributes" });
        expect(updateAttrsApiMock).not.toHaveBeenCalled();

        const attributes = {
            owner: "owner",
            group: "group",
            perms: "-rwxrwxrwx",
        };
        getAttributesMock.mockResolvedValue(attributes as any);

        // case 2: attributes provided from webview, pass owner/group as name
        await (view as any).onDidReceiveMessage({
            command: "update-attributes",
            attrs: attributes,
        });
        expect(updateAttributesMock).toHaveBeenCalled();
        expect(view.panel.webview.postMessage).toHaveBeenCalledWith({
            updated: true,
        });

        // case 2: attributes provided from webview, pass owner/group as IDs
        await (view as any).onDidReceiveMessage({
            command: "update-attributes",
            attrs: {
                ...attributes,
                owner: "1",
                group: "9001",
            },
        });
        expect(updateAttributesMock).toHaveBeenCalled();
        expect(view.panel.webview.postMessage).toHaveBeenCalled();
    });

    it("handles any errors while updating attributes", async () => {
        const getAttributesMock = jest.spyOn(ZoweUSSNode.prototype, "getAttributes").mockRejectedValue(new Error("Failed to update attributes"));
        await (view as any).onDidReceiveMessage({
            command: "update-attributes",
            attrs: { owner: "someowner" },
        });
        expect(getAttributesMock).toHaveBeenCalled();
        expect(view.panel.webview.postMessage).toHaveBeenCalledWith({
            updated: false,
        });
    });
});
