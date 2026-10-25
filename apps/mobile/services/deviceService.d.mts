import type { SessionManager } from './sessionCore';
import type { CollectorPolicy, IosCollectorNative } from './iosCollectorActivation.mjs';
export function enrollCurrentDevice(manager: SessionManager, native?: IosCollectorNative): Promise<string>;
export function revokeAndUnlinkDevice(manager: SessionManager, deviceId: string, policy: Pick<CollectorPolicy, 'permissionId'>, native: IosCollectorNative | undefined, requestId: string): Promise<void>;
