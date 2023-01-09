/*
 * This program and the accompanying materials are made available under the terms of the *
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at *
 * https://www.eclipse.org/legal/epl-v20.html                                      *
 *                                                                                 *
 * SPDX-License-Identifier: EPL-2.0                                                *
 *                                                                                 *
 * Copyright Contributors to the Zowe Project.                                     *
 *                                                                                 *
 */

import * as vscode from "vscode";
import * as globals from "../globals";
import * as nls from "vscode-nls";

nls.config({
    messageFormat: nls.MessageFormat.bundle,
    bundleFormat: nls.BundleFormat.standalone,
})();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export class SettingsConfig {
    /**
     * Retrieves a generic setting either in user or workspace.
     * <pre>{@code
     *  SettingsConfig.getDirectValue<boolean>("zowe.commands.alwaysEdit");
     * }</pre>
     * @param {string} key - The config property that needs retrieving
     */
    public static getDirectValue<T>(key: string): T {
        const [first, ...rest] = key.split(".");
        return vscode.workspace.getConfiguration(first).get(rest.join("."));
    }

    /**
     * Updates a generic setting either in user or workspace.
     * <pre>{@code
     *  SettingsConfig.setDirectValue("zowe.commands.alwaysEdit", true);
     * }</pre>
     * @param {string} key - The config property that needs updating
     * @param {any} value - The value to assign for the config property
     * @param target - VS Code configuration target (global or workspace)
     */
    public static setDirectValue(
        key: string,
        value: any,
        target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
    ): Thenable<void> {
        const [first, ...rest] = key.split(".");
        return vscode.workspace.getConfiguration(first).update(rest.join("."), value, target);
    }

    public static async standardizeSettings(): Promise<void> {
        const globalIsNotMigrated =
            SettingsConfig.configurations.inspect(globals.SETTINGS_VERSION).globalValue !==
            SettingsConfig.currentVersionNumber;
        const workspaceIsNotMigrated =
            SettingsConfig.configurations.inspect(globals.SETTINGS_VERSION).workspaceValue !==
            SettingsConfig.currentVersionNumber;
        const workspaceIsOpen = vscode.workspace.workspaceFolders !== undefined;
        const zoweSettingsExist = SettingsConfig.zoweOldConfigurations.length > 0;

        if (!zoweSettingsExist) {
            return;
        }

        if (workspaceIsNotMigrated && workspaceIsOpen) {
            await SettingsConfig.standardizeWorkspaceSettings();
        }

        if (globalIsNotMigrated) {
            await SettingsConfig.standardizeGlobalSettings();
        }
    }
    // Dictionary describing translation from old configuration names to new standardized names
    private static configurationDictionary = {
        "Zowe-Default-Datasets-Binary": globals.SETTINGS_DS_DEFAULT_BINARY,
        "Zowe-Default-Datasets-C": globals.SETTINGS_DS_DEFAULT_C,
        "Zowe-Default-Datasets-Classic": globals.SETTINGS_DS_DEFAULT_CLASSIC,
        "Zowe-Default-Datasets-PDS": globals.SETTINGS_DS_DEFAULT_PDS,
        "Zowe-Default-Datasets-PS": globals.SETTINGS_DS_DEFAULT_PS,
        "Zowe-Temp-Folder-Location": globals.SETTINGS_TEMP_FOLDER_PATH,
        "Zowe Commands: History": globals.SETTINGS_COMMANDS_HISTORY,
        "Zowe Commands: Always edit": globals.SETTINGS_COMMANDS_ALWAYS_EDIT,
        "Zowe-Automatic-Validation": globals.SETTINGS_AUTOMATIC_PROFILE_VALIDATION,
        "Zowe-DS-Persistent": globals.SETTINGS_DS_HISTORY,
        "Zowe-USS-Persistent": globals.SETTINGS_USS_HISTORY,
        "Zowe-Jobs-Persistent": globals.SETTINGS_JOBS_HISTORY,
    };

    private static get configurations() {
        return vscode.workspace.getConfiguration();
    }

    private static get zoweOldConfigurations() {
        return Object.keys(SettingsConfig.configurations).filter((key) =>
            key.match(new RegExp("Zowe-*|Zowe\\s*", "g"))
        );
    }

    private static get currentVersionNumber() {
        return vscode.extensions.getExtension("zowe.vscode-extension-for-zowe").packageJSON.version;
    }

    private static async promptReload(): Promise<void> {
        // Prompt user to reload VS Code window
        const reloadButton = localize("standardization.reload.button", "Reload Window");
        const infoMsg = localize(
            "standardization.reload.infoMessage",
            "Settings have been successfully migrated for Zowe Explorer version 2 and above. To apply these settings, please reload your VS Code window."
        );
        await vscode.window.showInformationMessage(infoMsg, ...[reloadButton])?.then(async (selection) => {
            if (selection === reloadButton) {
                await vscode.commands.executeCommand("workbench.action.reloadWindow");
            }
        });
    }

    private static async standardizeGlobalSettings(): Promise<void> {
        let globalIsMigrated =
            SettingsConfig.configurations.inspect(globals.SETTINGS_VERSION).globalValue !==
            SettingsConfig.currentVersionNumber;

        // Standardize global settings when old Zowe settings were found
        if (SettingsConfig.zoweOldConfigurations.length > 0) {
            SettingsConfig.zoweOldConfigurations.forEach(async (configuration) => {
                let globalValue: any = SettingsConfig.configurations.inspect(configuration).globalValue;

                // Adjust fetching of value due to schema change
                if (configuration === "Zowe-Temp-Folder-Location") {
                    globalValue = globalValue ? globalValue.folderPath : globalValue;
                }

                const newSetting = SettingsConfig.configurationDictionary[configuration];

                if (globalValue !== undefined) {
                    await SettingsConfig.setDirectValue(newSetting, globalValue);
                    globalIsMigrated = true;
                }
            });
        }

        if (globalIsMigrated) {
            await SettingsConfig.setDirectValue(globals.SETTINGS_VERSION, SettingsConfig.currentVersionNumber);
            await SettingsConfig.promptReload();
        }
    }

    private static async standardizeWorkspaceSettings(): Promise<void> {
        let workspaceIsMigrated = false;
        // Standardize workspace settings when old Zowe settings were found
        if (SettingsConfig.zoweOldConfigurations.length > 0) {
            // filter to only supported workspace configurations in scope
            const filteredConfigurations = SettingsConfig.zoweOldConfigurations.filter(
                (c) => !c.match(new RegExp("Zowe-[A-Za-z]+-Persistent|Zowe Commands: History", "g"))
            );

            for (const configuration of filteredConfigurations) {
                let workspaceValue: any = SettingsConfig.configurations.inspect(configuration).workspaceValue;

                if (configuration === "Zowe-Temp-Folder-Location") {
                    workspaceValue = workspaceValue ? workspaceValue.folderPath : workspaceValue;
                }

                const newSetting = SettingsConfig.configurationDictionary[configuration];

                if (workspaceValue !== undefined) {
                    await SettingsConfig.setDirectValue(
                        newSetting,
                        workspaceValue,
                        vscode.ConfigurationTarget.Workspace
                    );
                    workspaceIsMigrated = true;
                }
            }
        }

        if (workspaceIsMigrated) {
            await SettingsConfig.setDirectValue(
                globals.SETTINGS_VERSION,
                SettingsConfig.currentVersionNumber,
                vscode.ConfigurationTarget.Workspace
            );
        }
    }
}
