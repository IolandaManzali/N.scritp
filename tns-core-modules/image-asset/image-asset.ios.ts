import * as common from "./image-asset-common";
import { path as fsPath, knownFolders } from "../file-system";

global.moduleMerge(common, exports);

export class ImageAsset extends common.ImageAsset {
    private _ios: PHAsset;

    constructor(asset: string | PHAsset | UIImage) {
        super();
        if (typeof asset === "string") {
            if (asset.indexOf("~/") === 0) {
                asset = fsPath.join(knownFolders.currentApp().path, asset.replace("~/", ""));
            }

            this.nativeImage = UIImage.imageWithContentsOfFile(asset);
        }
        else if (asset instanceof UIImage) {
            this.nativeImage = asset
        }
        else {
            this.ios = asset;
        }
    }

    get ios(): PHAsset {
        return this._ios;
    }

    set ios(value: PHAsset) {
        this._ios = value;
    }

    public getImageAsync(callback: (image, error) => void, ignoreScaleFactor?: boolean) {
        if (!this.ios && !this.nativeImage) {
            callback(null, "Asset cannot be found.");
        }

        let srcWidth = this.nativeImage ? this.nativeImage.size.width : this.ios.pixelWidth;
        let srcHeight = this.nativeImage ? this.nativeImage.size.height : this.ios.pixelHeight;
        let requestedSize = common.getRequestedImageSize({ width: srcWidth, height: srcHeight }, this.options);

        if (this.nativeImage) {
            let newSize = CGSizeMake(requestedSize.width, requestedSize.height);
            let resizedImage = this.scaleImage(this.nativeImage, newSize, ignoreScaleFactor);
            callback(resizedImage, null);
            return;
        }

        let imageRequestOptions = PHImageRequestOptions.alloc().init();
        imageRequestOptions.deliveryMode = PHImageRequestOptionsDeliveryMode.HighQualityFormat;
        imageRequestOptions.networkAccessAllowed = true;

        PHImageManager.defaultManager().requestImageForAssetTargetSizeContentModeOptionsResultHandler(this.ios, requestedSize, PHImageContentMode.AspectFit, imageRequestOptions,
            (image, imageResultInfo) => {
                if (image) {
                    let resultImage = this.scaleImage(image, requestedSize, ignoreScaleFactor);
                    callback(resultImage, null);
                }
                else {
                    callback(null, imageResultInfo.valueForKey(PHImageErrorKey));
                }
            }
        );
    }

    public saveToFile(fileName: string, callback: (imagePath: string, error: any) => void) {
        if (!this.ios) {
            callback(null, "Asset cannot be found.");
        }

        const tempFolderPath = knownFolders.temp().path;
        const tempFilePath = fsPath.join(tempFolderPath, fileName);
        const options = PHImageRequestOptions.new();

        options.synchronous = true;
        options.version = PHImageRequestOptionsVersion.Current;
        options.deliveryMode = PHImageRequestOptionsDeliveryMode.HighQualityFormat;

        PHImageManager.defaultManager().requestImageDataForAssetOptionsResultHandler(this.ios, options,
            (...args) => {
                let nsData = args[0];
                const UTIType = args[1];
                const imageResultInfo = args[3];
                const imageExtension = this.getImageExtension(UTIType);
                const shouldResize = this.options && (this.options.width || this.options.height);
                const fullPath = `${tempFilePath}.${imageExtension}`;

                if (imageResultInfo.valueForKey(PHImageErrorKey)) {
                    callback(null, imageResultInfo.valueForKey(PHImageErrorKey));
                    return;
                }

                if (shouldResize) {
                    this.getImageAsync((image, err) => {
                        if (image) {
                            nsData = this.getImageData(image, imageExtension, this.options.quality);
                            nsData.writeToFileAtomically(fullPath, true);
                            callback(fullPath, null);
                        }
                        else {
                            callback(null, err);
                        }
                    }, true);
                } else {
                    nsData.writeToFileAtomically(fullPath, true);
                    callback(fullPath, null);
                }

            });
    }

    private getImageData(instance: UIImage, format: "png" | "jpg", quality = 0.9): NSData {
        var data = null;
        switch (format) {
            case "png":
                data = UIImagePNGRepresentation(instance);
                break;
            case "jpg":
                if (quality) {
                    quality = (quality - 0) / (100 - 0);  // Normalize quality on a scale of 0 to 1
                }

                data = UIImageJPEGRepresentation(instance, quality);
                break;
        }
        return data;
    }

    private getImageExtension(UTIType: string): "png" | "jpg" {
        switch (UTIType) {
            case kUTTypeJPEG:
                return "jpg";
            case kUTTypePNG:
                return "png";
            default:
                return "jpg";
        }
    }

    private scaleImage(image: UIImage, requestedSize: { width: number, height: number }, ignoreScaleFactor: boolean): UIImage {
        const scaleFactor = ignoreScaleFactor ? 1 : 0; // scaleFactor = 0 takes the scale factor of the device’s main screen.
        UIGraphicsBeginImageContextWithOptions(requestedSize, false, scaleFactor);
        image.drawInRect(CGRectMake(0, 0, requestedSize.width, requestedSize.height));
        let resultImage = UIGraphicsGetImageFromCurrentImageContext();
        UIGraphicsEndImageContext();
        return resultImage;
    }
}
