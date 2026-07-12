// Copyright (C) Microsoft Corporation. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

export * from './common';
export { default as MainToolbar } from './screenshot-bar';

export const stopEvent = (ev: React.MouseEvent) => ev.stopPropagation();
