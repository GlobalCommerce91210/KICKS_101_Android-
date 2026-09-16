export interface BrandAssetManifest {
  schemaVersion: string;
  productName: string;
  ownershipLabel: string;
  assetVersion: string;
  assets: {
    primary: {
      url: string;
      mimeType: string;
      width: number;
      height: number;
      sha256: string;
    };
  };
  altText: string;
  minimumAppVersion: string;
  updatedAt: string;
}

export const KICKS_BRAND_MANIFEST: BrandAssetManifest = {
  schemaVersion: "1.0",
  productName: "KICK’S",
  ownershipLabel: "A product of DataStorm Inc.",
  assetVersion: "mascot-2026-09-15-01",
  assets: {
    primary: {
      url: "https://assets.datastorminc.live/branding/mascot-2026-09-15-01.webp",
      mimeType: "image/webp",
      width: 1024,
      height: 1024,
      sha256: "a821fc03c3c3ef43ee167d4f87323294276c333ab4aac32cb90a53aa88ce3e48"
    }
  },
  altText: "KICK’S orange and gold mascot with blue eyes and glowing data rings",
  minimumAppVersion: "0.2.5",
  updatedAt: "2026-09-15T14:00:00Z"
};
