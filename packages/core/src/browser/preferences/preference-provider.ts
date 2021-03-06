/********************************************************************************
 * Copyright (C) 2018 Ericsson and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

/* eslint-disable @typescript-eslint/no-explicit-any */

import debounce = require('p-debounce');
import { injectable } from 'inversify';
import { JSONExt, JSONValue } from '@phosphor/coreutils/lib/json';
import URI from '../../common/uri';
import { Disposable, DisposableCollection, Emitter, Event } from '../../common';
import { Deferred } from '../../common/promise-util';
import { PreferenceScope } from './preference-scope';

export interface PreferenceProviderDataChange {
    readonly preferenceName: string;
    readonly newValue?: any;
    readonly oldValue?: any;
    readonly scope: PreferenceScope;
    readonly domain?: string[];
}

export interface PreferenceProviderDataChanges {
    [preferenceName: string]: PreferenceProviderDataChange
}

export interface PreferenceResolveResult<T> {
    configUri?: URI
    value?: T
}

@injectable()
export abstract class PreferenceProvider implements Disposable {

    protected readonly onDidPreferencesChangedEmitter = new Emitter<PreferenceProviderDataChanges>();
    readonly onDidPreferencesChanged: Event<PreferenceProviderDataChanges> = this.onDidPreferencesChangedEmitter.event;

    protected readonly toDispose = new DisposableCollection();

    protected readonly _ready = new Deferred<void>();

    constructor() {
        this.toDispose.push(this.onDidPreferencesChangedEmitter);
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    protected deferredChanges: PreferenceProviderDataChanges | undefined;
    protected _pendingChanges: Promise<boolean> = Promise.resolve(false);
    get pendingChanges(): Promise<boolean> {
        return this._pendingChanges;
    }

    /**
     * Informs the listeners that one or more preferences of this provider are changed.
     * The listeners are able to find what was changed from the emitted event.
     */
    protected emitPreferencesChangedEvent(changes: PreferenceProviderDataChanges | PreferenceProviderDataChange[]): Promise<boolean> {
        if (Array.isArray(changes)) {
            for (const change of changes) {
                this.mergePreferenceProviderDataChange(change);
            }
        } else {
            for (const preferenceName of Object.keys(changes)) {
                this.mergePreferenceProviderDataChange(changes[preferenceName]);
            }
        }
        return this._pendingChanges = this.fireDidPreferencesChanged();
    }

    protected mergePreferenceProviderDataChange(change: PreferenceProviderDataChange): void {
        if (!this.deferredChanges) {
            this.deferredChanges = {};
        }
        const current = this.deferredChanges[change.preferenceName];
        const { newValue, scope, domain } = change;
        if (!current) {
            // new
            this.deferredChanges[change.preferenceName] = change;
        } else if (current.oldValue === newValue) {
            // delete
            delete this.deferredChanges[change.preferenceName];
        } else {
            // update
            Object.assign(current, { newValue, scope, domain });
        }
    }

    protected fireDidPreferencesChanged = debounce(() => {
        const changes = this.deferredChanges;
        this.deferredChanges = undefined;
        if (changes && Object.keys(changes).length) {
            this.onDidPreferencesChangedEmitter.fire(changes);
            return true;
        }
        return false;
    }, 0);

    get<T>(preferenceName: string, resourceUri?: string): T | undefined {
        return this.resolve<T>(preferenceName, resourceUri).value;
    }

    resolve<T>(preferenceName: string, resourceUri?: string): PreferenceResolveResult<T> {
        const value = this.getPreferences(resourceUri)[preferenceName];
        if (value !== undefined) {
            return {
                value,
                configUri: this.getConfigUri(resourceUri)
            };
        }
        return {};
    }

    abstract getPreferences(resourceUri?: string): { [p: string]: any };

    /**
     * Resolves only if all changes were delivered.
     * If changes were made then implementation must either
     * await on `this.emitPreferencesChangedEvent(...)` or
     * `this.pendingChanges` if chnages are fired indirectly.
     */
    abstract setPreference(key: string, value: any, resourceUri?: string): Promise<boolean>;

    /**
     * Resolved when the preference provider is ready to provide preferences
     * It should be resolved by subclasses.
     */
    get ready(): Promise<void> {
        return this._ready.promise;
    }

    /**
     * undefined if all belongs
     */
    getDomain(): string[] | undefined {
        return undefined;
    }

    /**
     * undefined if cannot be provided for the given resource uri
     */
    getConfigUri(resourceUri?: string): URI | undefined {
        return undefined;
    }

    static merge(source: JSONValue | undefined, target: JSONValue): JSONValue {
        if (source === undefined || !JSONExt.isObject(source)) {
            return JSONExt.deepCopy(target);
        }
        if (JSONExt.isPrimitive(target)) {
            return {};
        }
        for (const key of Object.keys(target)) {
            const value = (target as any)[key];
            if (key in source) {
                if (JSONExt.isObject(source[key]) && JSONExt.isObject(value)) {
                    this.merge(source[key], value);
                    continue;
                }
            }
            source[key] = JSONExt.deepCopy(value);
        }
        return source;
    }

}
