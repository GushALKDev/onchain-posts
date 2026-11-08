import { TrustedKeysFileSchema } from '@phi/core';
import trustedKeysFile from '../../../config/trusted-keys.json';

/** The copy of config/trusted-keys.json served with this page (a convenience: the platform serves it). */
export const bundledKeys = TrustedKeysFileSchema.parse(trustedKeysFile).keys;
