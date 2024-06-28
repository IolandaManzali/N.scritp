import { Color } from '../../../../color';
import { Trace } from '../../../../trace';
import { SDK_VERSION } from '../../../../utils/constants';

export * from './view-helper-common';
export const IOSHelper = 0;

const androidxGraphics = androidx.core.graphics;

export class AndroidHelper {
	static getDrawableColor(drawable: android.graphics.drawable.Drawable): Color {
		if (!drawable) {
			return null;
		}

		let color: number;

		if (drawable instanceof org.nativescript.widgets.BorderDrawable) {
			color = drawable.getBackgroundColor();
		} else if (drawable instanceof android.graphics.drawable.ColorDrawable) {
			color = drawable.getColor();
		} else {
			// This is a way to retrieve drawable color when set using color filter
			color = (drawable as any)._backgroundColor;
		}

		return new Color(color);
	}

	static setDrawableColor(color: number, drawable: android.graphics.drawable.Drawable, blendMode?: androidx.core.graphics.BlendModeCompat): void {
		// ColorDrawable is an older class that had support for setColorFilter on API 21
		if (SDK_VERSION < 21 && drawable instanceof android.graphics.drawable.ColorDrawable) {
			drawable.setColor(color);
		} else {
			drawable.setColorFilter(androidxGraphics.BlendModeColorFilterCompat.createBlendModeColorFilterCompat(color, blendMode ?? androidxGraphics.BlendModeCompat.SRC_IN));

			// This is a way to retrieve drawable color when set using color filter
			(drawable as any)._backgroundColor = color;
		}
	}

	static clearDrawableColor(drawable: android.graphics.drawable.Drawable): void {
		// ColorDrawable is an older class that had support for setColorFilter on API 21
		if (SDK_VERSION < 21 && drawable instanceof android.graphics.drawable.ColorDrawable) {
			drawable.setColor(-1);
		} else {
			drawable.clearColorFilter();

			// This is a way to retrieve drawable color when set using color filter
			delete (drawable as any)._backgroundColor;
		}
	}

	static getCopyOrDrawable(drawable: android.graphics.drawable.Drawable, resources?: android.content.res.Resources): android.graphics.drawable.Drawable {
		if (drawable) {
			const constantState = drawable.getConstantState();
			if (constantState) {
				return resources ? constantState.newDrawable(resources) : constantState.newDrawable();
			}
		}

		return drawable;
	}
}
