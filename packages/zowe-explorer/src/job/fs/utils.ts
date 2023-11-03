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

import { FileEntry, FsEntry } from "@zowe/zowe-explorer-api";
import { JobEntry, SpoolEntry } from "./types";
import { FileType } from "vscode";

export function isJobEntry(entry: FsEntry): entry is JobEntry {
    return entry != null && entry.type == FileType.Directory;
}

export function isFileEntry(entry: FsEntry): entry is FileEntry {
    return entry != null && entry.type == FileType.File;
}

export function isSpoolEntry(entry: FsEntry): entry is SpoolEntry {
    return entry != null && entry["wasAccessed"] !== undefined;
}