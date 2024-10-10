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

import * as vscode from "vscode";
import { Gui, imperative, IZoweTreeNode, PersistenceSchemaEnum, Validation } from "@zowe/zowe-explorer-api";
import { ZowePersistentFilters } from "../tools/ZowePersistentFilters";
import { ZoweLogger } from "../tools/ZoweLogger";
import { SharedContext } from "../trees/shared/SharedContext";
import { Profiles } from "../configuration/Profiles";
import { Constants } from "../configuration/Constants";
import { IconGenerator } from "../icons/IconGenerator";
import { IconUtils } from "../icons/IconUtils";
import { AuthUtils } from "../utils/AuthUtils";
import { ProfileManagement } from "../management/ProfileManagement";
import { Definitions } from "../configuration/Definitions";
import { SettingsConfig } from "../configuration/SettingsConfig";
import { FilterDescriptor, FilterItem } from "../management/FilterManagement";
import { ZoweTerminal } from "../tools/ZoweTerminal";

export interface ICommandProviderDialogs {
    commandSubmitted: string;
    searchCommand: string;
    selectCommand: (args: string[]) => string;
    writeCommand: (args: string[]) => string;
    defaultText: string;
    selectProfile: string;
}

export abstract class ZoweCommandProvider {
    // eslint-disable-next-line no-magic-numbers
    private static readonly totalFilters: number = 10;
    protected readonly operationCancelled: string = vscode.l10n.t("Operation cancelled");
    public profileInstance: Profiles;
    public history: ZowePersistentFilters;
    // Event Emitters used to notify subscribers that the refresh event has fired
    public mOnDidChangeTreeData: vscode.EventEmitter<IZoweTreeNode | void> = new vscode.EventEmitter<IZoweTreeNode | undefined>();
    public readonly onDidChangeTreeData: vscode.Event<IZoweTreeNode | void> = this.mOnDidChangeTreeData.event;

    public abstract dialogs: ICommandProviderDialogs;
    private useIntegratedTerminals: boolean;
    public outputChannel: vscode.OutputChannel;
    public terminal: vscode.Terminal;
    public pseudoTerminal: ZoweTerminal;

    public constructor(protected terminalName: string) {
        this.history = new ZowePersistentFilters(PersistenceSchemaEnum.Commands, ZoweCommandProvider.totalFilters);
        this.profileInstance = Profiles.getInstance();

        this.useIntegratedTerminals = SettingsConfig.getDirectValue(Constants.SETTINGS_COMMANDS_INTEGRATED_TERMINALS) ?? true;
        if (!this.useIntegratedTerminals) {
            this.outputChannel = Gui.createOutputChannel(this.terminalName);
        }
    }

    public abstract formatCommandLine(command: string, profile: imperative.IProfileLoaded): string;
    public abstract runCommand(profile: imperative.IProfileLoaded, command: string): Promise<string>;

    public async issueCommand(profile: imperative.IProfileLoaded, command: string): Promise<void> {
        ZoweLogger.trace("ZoweCommandProvider.issueCommand called.");
        if (profile == null || command == null) {
            return;
        }
        try {
            if (this.useIntegratedTerminals) {
                this.pseudoTerminal = new ZoweTerminal(
                    this.terminalName,
                    async (command: string): Promise<string> => {
                        // this.history.addSearchHistory(command);
                        return this.runCommand(profile, command);
                    },
                    {
                        message: vscode.l10n.t({
                            message: "Welcome to the integrated terminal for: {0}",
                            args: [this.terminalName],
                            comment: ["Terminal Name"],
                        }),
                        history: [...this.history.getSearchHistory()].reverse() ?? [],
                        startup: command,
                        formatCommandLine: (cmd: string) => this.formatCommandLine(cmd, profile),
                    }
                );
                this.terminal = vscode.window.createTerminal({ name: this.terminalName, pty: this.pseudoTerminal });
                this.terminal.show();
            } else {
                this.outputChannel.appendLine(this.formatCommandLine(command, profile));
                const response = await Gui.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: this.dialogs.commandSubmitted,
                    },
                    () => {
                        return this.runCommand(profile, command);
                    }
                );
                this.outputChannel.appendLine(response);
                this.outputChannel.show(true);
                this.history.addSearchHistory(command);
            }
        } catch (error) {
            await AuthUtils.errorHandling(error, profile.name);
        }
    }

    public async selectNodeProfile(cmdTree: Definitions.Trees): Promise<imperative.IProfileLoaded> {
        ZoweLogger.trace("ZoweCommandProvider.selectNodeProfile called.");

        const profileNamesList = ProfileManagement.getRegisteredProfileNameList(cmdTree);
        if (profileNamesList.length > 0) {
            const quickPickOptions: vscode.QuickPickOptions = {
                placeHolder: this.dialogs.selectProfile,
                ignoreFocusOut: true,
                canPickMany: false,
            };
            const sesName = await Gui.showQuickPick(profileNamesList, quickPickOptions);
            if (sesName === undefined) {
                Gui.showMessage(this.operationCancelled);
                return;
            }
            const profile = this.profileInstance.allProfiles.find((tempProfile) => tempProfile.name === sesName);
            await this.profileInstance.checkCurrentProfile(profile);
            if (this.profileInstance.validProfile === Validation.ValidationType.INVALID) {
                Gui.errorMessage(vscode.l10n.t("Profile is invalid"));
                return;
            }
            return profile;
        } else {
            const noProfAvailable = vscode.l10n.t("No profiles available");
            ZoweLogger.info(noProfAvailable);
            Gui.showMessage(noProfAvailable);
        }
    }

    public async selectServiceProfile(profiles: imperative.IProfileLoaded[] = []): Promise<imperative.IProfileLoaded> {
        ZoweLogger.trace("ZoweCommandProvider.selectServiceProfile called.");
        let profile: imperative.IProfileLoaded;
        if (profiles.length > 1) {
            const profileNamesList = profiles.map((tempProfile) => {
                return tempProfile.name;
            });
            const quickPickOptions: vscode.QuickPickOptions = {
                placeHolder: this.dialogs.selectProfile,
                ignoreFocusOut: true,
                canPickMany: false,
            };
            const sesName = await Gui.showQuickPick(profileNamesList, quickPickOptions);
            if (sesName === undefined) {
                Gui.showMessage(this.operationCancelled);
                return;
            }
            profile = profiles.filter((tempProfile) => tempProfile.name === sesName)[0];
        } else if (profiles.length > 0) {
            profile = profiles[0];
        }
        return profile;
    }

    public async getQuickPick(dialogOptions: string[]): Promise<string> {
        ZoweLogger.trace("ZoweCommandProvider.getQuickPick called.");
        let response = "";
        const alwaysEdit: boolean = SettingsConfig.getDirectValue(Constants.SETTINGS_COMMANDS_ALWAYS_EDIT);
        if (this.history.getSearchHistory().length > 0) {
            const createPick = new FilterDescriptor(this.dialogs.defaultText);
            const items: vscode.QuickPickItem[] = this.history.getSearchHistory().map((element) => new FilterItem({ text: element }));
            const quickpick = Gui.createQuickPick();
            quickpick.placeholder = alwaysEdit ? this.dialogs.writeCommand(dialogOptions) : this.dialogs.selectCommand(dialogOptions);
            quickpick.items = [createPick, ...items];
            quickpick.ignoreFocusOut = true;
            quickpick.show();
            const choice = await Gui.resolveQuickPick(quickpick);
            quickpick.hide();
            if (!choice) {
                Gui.showMessage(this.operationCancelled);
                return;
            }
            if (choice instanceof FilterDescriptor) {
                if (quickpick.value) {
                    response = quickpick.value;
                }
            } else {
                response = choice.label;
            }
        }
        if (!response || alwaysEdit) {
            // manually entering a search
            const options2: vscode.InputBoxOptions = {
                prompt: this.dialogs.searchCommand,
                value: response,
                valueSelection: response ? [response.length, response.length] : undefined,
            };
            // get user input
            response = await Gui.showInputBox(options2);
            if (!response) {
                Gui.showMessage(this.operationCancelled);
                return;
            }
        }
        return response;
    }

    /**
     * Called whenever the tree needs to be refreshed, and fires the data change event
     *
     */
    public refreshElement(element: IZoweTreeNode): void {
        ZoweLogger.trace("ZoweCommandProvider.refreshElement called.");
        element.dirty = true;
        this.mOnDidChangeTreeData.fire(element);
    }

    /**
     * Called whenever the tree needs to be refreshed, and fires the data change event
     *
     */
    public refresh(): void {
        ZoweLogger.trace("ZoweCommandProvider.refresh called.");
        this.mOnDidChangeTreeData.fire();
    }

    public async checkCurrentProfile(node: IZoweTreeNode): Promise<Validation.IValidationProfile> {
        ZoweLogger.trace("ZoweCommandProvider.checkCurrentProfile called.");
        const profile = node.getProfile();
        const profileStatus = await Profiles.getInstance().checkCurrentProfile(profile);
        if (profileStatus.status === "inactive") {
            if (
                SharedContext.isSessionNotFav(node) &&
                (node.contextValue.toLowerCase().includes("session") || node.contextValue.toLowerCase().includes("server"))
            ) {
                node.contextValue = node.contextValue.replace(/(?<=.*)(_Active|_Inactive|_Unverified)$/, "");
                node.contextValue = node.contextValue + Constants.INACTIVE_CONTEXT;
                const inactiveIcon = IconGenerator.getIconById(IconUtils.IconId.sessionInactive);
                if (inactiveIcon) {
                    node.iconPath = inactiveIcon.path;
                }
            }

            await AuthUtils.errorHandling(
                vscode.l10n.t({
                    message:
                        "Profile Name {0} is inactive. Please check if your Zowe server is active or if the URL and port in your profile is correct.",
                    args: [profile.name],
                    comment: ["Profile name"],
                })
            );
        } else if (profileStatus.status === "active") {
            if (
                SharedContext.isSessionNotFav(node) &&
                (node.contextValue.toLowerCase().includes("session") || node.contextValue.toLowerCase().includes("server"))
            ) {
                node.contextValue = node.contextValue.replace(/(?<=.*)(_Active|_Inactive|_Unverified)$/, "");
                node.contextValue = node.contextValue + Constants.ACTIVE_CONTEXT;
                const activeIcon = IconGenerator.getIconById(IconUtils.IconId.sessionActive);
                if (activeIcon) {
                    node.iconPath = activeIcon.path;
                }
            }
        } else if (profileStatus.status === "unverified") {
            if (
                SharedContext.isSessionNotFav(node) &&
                (node.contextValue.toLowerCase().includes("session") || node.contextValue.toLowerCase().includes("server"))
            ) {
                node.contextValue = node.contextValue.replace(/(?<=.*)(_Active|_Inactive|_Unverified)$/, "");
                node.contextValue = node.contextValue + Constants.UNVERIFIED_CONTEXT;
            }
        }
        this.refresh();
        return profileStatus;
    }
}