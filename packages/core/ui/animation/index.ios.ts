// Types
import { AnimationDefinitionInternal, AnimationPromise, IOSView, PropertyAnimation, PropertyAnimationInfo } from './animation-common';
import { View } from '../core/view';

// Requires
import { AnimationBase, Properties, CubicBezierAnimationCurve } from './animation-common';
import { Trace } from '../../trace';
import { rotateProperty, rotateXProperty, rotateYProperty, translateXProperty, translateYProperty, scaleXProperty, scaleYProperty, heightProperty, widthProperty, PercentLength } from '../styling/style-properties';
import { CssAnimationProperty, Property } from '../core/properties';

import { iOSNativeHelper } from '../../utils/native-helper';

import { Screen } from '../../platform';
import { Color } from '../../color';
import { Style } from '../styling/style';

export * from './animation-common';
export { KeyframeAnimation, KeyframeAnimationInfo, KeyframeDeclaration, KeyframeInfo } from './keyframe-animation';

const _transform = '_transform';
const _skip = '_skip';

class AnimationInfo {
	public propertyNameToAnimate: string;
	public subPropertiesToAnimate?: string[];
	public fromValue: any;
	public toValue: any;
	public duration: number;
	public repeatCount: number;
	public delay: number;
}

export function applyAnimationProperty(styleOrView: View, property: Property<View, any>, value, setKeyFrame: boolean);
export function applyAnimationProperty(styleOrView: Style, property: CssAnimationProperty<Style, any>, value, setKeyFrame: boolean);
export function applyAnimationProperty(styleOrView: any, property: any, value, setKeyFrame: boolean) {
	styleOrView[setKeyFrame && property['keyframe'] ? property['keyframe'] : property.name] = value;
}

@NativeClass
class AnimationDelegateImpl extends NSObject implements CAAnimationDelegate {
	public nextAnimation: Function;

	// The CAAnimationDelegate protocol has been introduced in the iOS 10 SDK
	static ObjCProtocols = (<any>global).CAAnimationDelegate ? [(<any>global).CAAnimationDelegate] : [];

	private _animation: WeakRef<Animation>;
	private _propertyAnimation: PropertyAnimationInfo;

	public static initWithFinishedCallback(animation: WeakRef<Animation>, propertyAnimation: PropertyAnimationInfo): AnimationDelegateImpl {
		const delegate = <AnimationDelegateImpl>AnimationDelegateImpl.new();
		delegate._animation = animation;
		delegate._propertyAnimation = propertyAnimation;

		return delegate;
	}

	animationDidStart(anim: CAAnimation): void {
		const value = this._propertyAnimation.value;
		const animation = this._animation?.get();
		const setKeyFrame = animation?.valueSource === 'keyframe';
		const targetStyle = this._propertyAnimation.target.style;

		(<IOSView>this._propertyAnimation.target)._suspendPresentationLayerUpdates();
		switch (this._propertyAnimation.propertyName) {
			case Properties.rotate:
				applyAnimationProperty(targetStyle, rotateXProperty, value.x, setKeyFrame);
				applyAnimationProperty(targetStyle, rotateYProperty, value.y, setKeyFrame);
				applyAnimationProperty(targetStyle, rotateProperty, value.z, setKeyFrame);
				break;
			case Properties.translate:
				applyAnimationProperty(targetStyle, translateXProperty, value.x, setKeyFrame);
				applyAnimationProperty(targetStyle, translateYProperty, value.y, setKeyFrame);
				break;
			case Properties.scale:
				applyAnimationProperty(targetStyle, scaleXProperty, value.x || 1e-6, setKeyFrame);
				applyAnimationProperty(targetStyle, scaleYProperty, value.y || 1e-6, setKeyFrame);
				break;
			case _transform:
				const translateValue = value[Properties.rotate];
				if (translateValue !== undefined) {
					applyAnimationProperty(targetStyle, translateXProperty, translateValue.x, setKeyFrame);
					applyAnimationProperty(targetStyle, translateYProperty, translateValue.y, setKeyFrame);
				}
				const rotateValue = value[Properties.rotate];
				if (rotateValue !== undefined) {
					applyAnimationProperty(targetStyle, rotateXProperty, rotateValue.x, setKeyFrame);
					applyAnimationProperty(targetStyle, rotateYProperty, rotateValue.y, setKeyFrame);
					applyAnimationProperty(targetStyle, rotateProperty, rotateValue.z, setKeyFrame);
				}
				const scaleValue = value[Properties.scale];
				if (scaleValue !== undefined) {
					const x = scaleValue.x;
					const y = scaleValue.y;
					applyAnimationProperty(targetStyle, scaleXProperty, scaleValue.x || 1e-6, setKeyFrame);
					applyAnimationProperty(targetStyle, scaleYProperty, scaleValue.y || 1e-6, setKeyFrame);
				}
				break;
			default:
				const property = this._propertyAnimation.property;
				if (property) {
					applyAnimationProperty(targetStyle, property, value, setKeyFrame);
				}
				break;
		}

		(<IOSView>this._propertyAnimation.target)._resumePresentationLayerUpdates();
	}

	public animationDidStopFinished(anim: CAAnimation, finished: boolean): void {
		const animation = this._animation?.get();
		if (animation) {
			animation.animationFinishedCallback(!finished);
		}
		if (finished && this.nextAnimation) {
			this.nextAnimation();
		}
	}
}

export function _resolveAnimationCurve(curve: string | CubicBezierAnimationCurve | CAMediaTimingFunction): CAMediaTimingFunction | string {
	switch (curve) {
		case 'easeIn':
			return CAMediaTimingFunction.functionWithName(kCAMediaTimingFunctionEaseIn);
		case 'easeOut':
			return CAMediaTimingFunction.functionWithName(kCAMediaTimingFunctionEaseOut);
		case 'easeInOut':
			return CAMediaTimingFunction.functionWithName(kCAMediaTimingFunctionEaseInEaseOut);
		case 'linear':
			return CAMediaTimingFunction.functionWithName(kCAMediaTimingFunctionLinear);
		case 'spring':
			return curve;
		case 'ease':
			return CAMediaTimingFunction.functionWithControlPoints(0.25, 0.1, 0.25, 1.0);
		default:
			if (curve instanceof CAMediaTimingFunction) {
				return curve;
			} else if (curve instanceof CubicBezierAnimationCurve) {
				const animationCurve = <CubicBezierAnimationCurve>curve;

				return CAMediaTimingFunction.functionWithControlPoints(animationCurve.x1, animationCurve.y1, animationCurve.x2, animationCurve.y2);
			} else {
				console.error(`Invalid animation curve: ${curve}`);
			}
	}
}

export class Animation extends AnimationBase {
	protected _iOSAnimationFunction: Function;
	protected _finishedAnimations: number;
	protected _cancelledAnimations: number;
	protected _mergedPropertyAnimations: Array<PropertyAnimationInfo>;
	protected _valueSource: 'animation' | 'keyframe';

	get valueSource() {
		return this._valueSource;
	}
	protected _wasCancelled = false;
	constructor(animationDefinitions: Array<AnimationDefinitionInternal>, playSequentially?: boolean) {
		super(animationDefinitions, playSequentially);

		this._valueSource = 'animation';
		if (animationDefinitions.length > 0 && animationDefinitions[0].valueSource !== undefined) {
			this._valueSource = animationDefinitions[0].valueSource;
		}
		if (!playSequentially) {
			if (Trace.isEnabled()) {
				Trace.write('Non-merged Property Animations: ' + this._propertyAnimations.length, Trace.categories.Animation);
			}
			this._mergedPropertyAnimations = Animation._mergeAffineTransformAnimations(this._propertyAnimations);
			if (Trace.isEnabled()) {
				Trace.write('Merged Property Animations: ' + this._mergedPropertyAnimations.length, Trace.categories.Animation);
			}
		} else {
			this._mergedPropertyAnimations = this._propertyAnimations;
		}

		this._iOSAnimationFunction = this._createiOSAnimationFunction(this._mergedPropertyAnimations, 0, this._playSequentially);
	}

	animationFinishedCallback(cancelled: boolean) {
		if (this._playSequentially) {
			// This function will be called by the last animation when done or by another animation if the user cancels them halfway through.
			if (cancelled) {
				this._rejectAnimationFinishedPromise();
			} else {
				this._resolveAnimationFinishedPromise();
			}
		} else {
			// This callback will be called by each INDIVIDUAL animation when it finishes or is cancelled.
			if (cancelled) {
				this._cancelledAnimations++;
			} else {
				this._finishedAnimations++;
			}

			if (this._cancelledAnimations > 0 && this._cancelledAnimations + this._finishedAnimations === this._mergedPropertyAnimations.length) {
				if (Trace.isEnabled()) {
					Trace.write(this._cancelledAnimations + ' animations cancelled.', Trace.categories.Animation);
				}
				this._rejectAnimationFinishedPromise();
			} else if (this._finishedAnimations === this._mergedPropertyAnimations.length) {
				if (Trace.isEnabled()) {
					Trace.write(this._finishedAnimations + ' animations finished.', Trace.categories.Animation);
				}
				this._resolveAnimationFinishedPromise();
			}
		}
	}

	public play(): AnimationPromise {
		if (this.isPlaying) {
			return this._rejectAlreadyPlaying();
		}
		const animationFinishedPromise = super.play();
		this._wasCancelled = false;
		this._finishedAnimations = 0;
		this._cancelledAnimations = 0;
		this._iOSAnimationFunction();

		return animationFinishedPromise;
	}

	public cancel(): void {
		if (!this.isPlaying) {
			Trace.write('Animation is not currently playing.', Trace.categories.Animation, Trace.messageType.warn);

			return;
		}
		this._wasCancelled = true;
		// this._iOSAnimators.forEach((animator) => {
		// 	animator.stopAnimation(false);
		// 	animator.finishAnimationAtPosition(UIViewAnimatingPosition.Current);
		// });
		let i = 0;
		const length = this._mergedPropertyAnimations.length;
		for (; i < length; i++) {
			const propertyAnimation = this._mergedPropertyAnimations[i];
			propertyAnimation.target.nativeViewProtected.layer.removeAllAnimations();
			if (propertyAnimation._propertyResetCallback) {
				propertyAnimation._propertyResetCallback(propertyAnimation._originalValue, this._valueSource);
			}
		}
	}

	public _resolveAnimationCurve(curve: string | CubicBezierAnimationCurve | CAMediaTimingFunction): CAMediaTimingFunction | string {
		return _resolveAnimationCurve(curve);
	}

	protected _createiOSAnimationFunction(propertyAnimations: Array<PropertyAnimation>, index: number, playSequentially: boolean): Function {
		return (cancelled?: boolean) => {
			if (cancelled) {
				if (Trace.isEnabled()) {
					Trace.write('Animation ' + (index - 1).toString() + ' was cancelled. Will skip the rest of animations and call finishedCallback(true).', Trace.categories.Animation);
				}
				this.animationFinishedCallback(cancelled);

				return;
			}
			const animationInfo = propertyAnimations[index];
			this._createNativeUIViewAnimation(propertyAnimations, index, playSequentially, animationInfo);
		};
	}

	protected _getNativeAnimationArguments(animation: PropertyAnimationInfo, useCABasicAnimation = false): AnimationInfo {
		const view = animation.target;
		const style = view.style;
		const nativeView = <UIView>view.nativeViewProtected;
		const parent = view.parent as View;

		let propertyNameToAnimate = animation.propertyName;
		let subPropertyNameToAnimate;
		let toValue = animation.value;
		let fromValue;
		const setKeyFrame = this._valueSource === 'keyframe';
		if (nativeView?.layer) {
			switch (animation.propertyName) {
				case Properties.rotate:
					animation._originalValue = {
						x: view.rotateX,
						y: view.rotateY,
						z: view.rotate,
					};
					animation._propertyResetCallback = (value) => {
						applyAnimationProperty(style, rotateXProperty, value.x, setKeyFrame);
						applyAnimationProperty(style, rotateYProperty, value.y, setKeyFrame);
						applyAnimationProperty(style, rotateProperty, value.z, setKeyFrame);
					};

					propertyNameToAnimate = 'transform.rotation';
					subPropertyNameToAnimate = ['x', 'y', 'z'];
					fromValue = {
						x: nativeView.layer.valueForKeyPath('transform.rotation.x'),
						y: nativeView.layer.valueForKeyPath('transform.rotation.y'),
						z: nativeView.layer.valueForKeyPath('transform.rotation.z'),
					};

					if (animation.target.rotateX !== undefined && animation.target.rotateX !== 0 && Math.floor(toValue / 360) - toValue / 360 === 0) {
						fromValue.x = (animation.target.rotateX * Math.PI) / 180;
					}
					if (animation.target.rotateY !== undefined && animation.target.rotateY !== 0 && Math.floor(toValue / 360) - toValue / 360 === 0) {
						fromValue.y = (animation.target.rotateY * Math.PI) / 180;
					}
					if (animation.target.rotate !== undefined && animation.target.rotate !== 0 && Math.floor(toValue / 360) - toValue / 360 === 0) {
						fromValue.z = (animation.target.rotate * Math.PI) / 180;
					}

					// Respect only value.z for back-compat until 3D rotations are implemented
					toValue = {
						x: (toValue.x * Math.PI) / 180,
						y: (toValue.y * Math.PI) / 180,
						z: (toValue.z * Math.PI) / 180,
					};
					break;
				case Properties.translate:
					animation._originalValue = {
						x: view.translateX,
						y: view.translateY,
					};
					animation._propertyResetCallback = (value, valueSource) => {
						applyAnimationProperty(style, translateXProperty, value.x, setKeyFrame);
						applyAnimationProperty(style, translateYProperty, value.y, setKeyFrame);
					};
					propertyNameToAnimate = 'transform';
					fromValue = NSValue.valueWithCATransform3D(nativeView.layer.transform);
					toValue = NSValue.valueWithCATransform3D(CATransform3DTranslate(nativeView.layer.transform, toValue.x, toValue.y, 0));
					break;
				case Properties.scale:
					toValue.x = toValue.x || 1e-6;
					toValue.y = toValue.y || 1e-6;

					animation._originalValue = { x: view.scaleX, y: view.scaleY };
					animation._propertyResetCallback = (value, valueSource) => {
						applyAnimationProperty(style, scaleXProperty, value.x, setKeyFrame);
						applyAnimationProperty(style, scaleYProperty, value.y, setKeyFrame);
					};
					propertyNameToAnimate = 'transform';
					fromValue = NSValue.valueWithCATransform3D(nativeView.layer.transform);
					toValue = NSValue.valueWithCATransform3D(CATransform3DScale(nativeView.layer.transform, toValue.x, toValue.y, 1));
					break;
				case _transform:
					fromValue = NSValue.valueWithCATransform3D(nativeView.layer.transform);
					animation._originalValue = {
						xs: view.scaleX,
						ys: view.scaleY,
						xt: view.translateX,
						yt: view.translateY,
						rx: view.rotateX,
						ry: view.rotateY,
						rz: view.rotate,
					};
					animation._propertyResetCallback = (value, valueSource) => {
						applyAnimationProperty(style, translateXProperty, value.xt, setKeyFrame);
						applyAnimationProperty(style, translateYProperty, value.yt, setKeyFrame);
						applyAnimationProperty(style, scaleXProperty, value.xs, setKeyFrame);
						applyAnimationProperty(style, scaleYProperty, value.ys, setKeyFrame);
						applyAnimationProperty(style, rotateXProperty, value.rx, setKeyFrame);
						applyAnimationProperty(style, rotateYProperty, value.ry, setKeyFrame);
						applyAnimationProperty(style, rotateProperty, value.rz, setKeyFrame);
					};
					propertyNameToAnimate = 'transform';
					toValue = NSValue.valueWithCATransform3D(Animation._createNativeAffineTransform(animation));
					break;
				case Properties.width:
				case Properties.height: {
					if (useCABasicAnimation) {
						const direction: string = animation.propertyName;
						const isHeight: boolean = direction === 'height';
						propertyNameToAnimate = 'bounds';
						if (!parent) {
							throw new Error(`cannot animate ${direction} on root view`);
						}
						const parentExtent: number = isHeight ? parent.getMeasuredHeight() : parent.getMeasuredWidth();
						const asNumber = PercentLength.toDevicePixels(PercentLength.parse(toValue), parentExtent, parentExtent) / Screen.mainScreen.scale;
						const currentBounds = nativeView.layer.bounds;
						const extentX = isHeight ? currentBounds.size.width : asNumber;
						const extentY = isHeight ? asNumber : currentBounds.size.height;
						fromValue = NSValue.valueWithCGRect(currentBounds);
						toValue = NSValue.valueWithCGRect(CGRectMake(currentBounds.origin.x, currentBounds.origin.y, extentX, extentY));
						animation._originalValue = view.height;
						animation._propertyResetCallback = (value) => {
							const prop = isHeight ? heightProperty : widthProperty;
							applyAnimationProperty(style, prop, value, setKeyFrame);
						};
						break;
					}
				}
				default:
					if (animation.property) {
						// animation._originalValue = view.backgroundColor;
						animation._originalValue = animation.target.style[animation.property.name];
						animation._propertyResetCallback = (value) => {
							applyAnimationProperty(style, animation.property, value, setKeyFrame);
						};
						fromValue = animation._originalValue;
						if (animation._originalValue instanceof Color) {
							animation._originalValue = animation._originalValue;
							fromValue = animation._originalValue.ios.CGColor;
						}
						if (toValue instanceof Color) {
							if (nativeView instanceof UILabel) {
								nativeView.setValueForKey(UIColor.clearColor, 'backgroundColor');
							}
							toValue = toValue.ios.CGColor;
						}
					} else {
						console.error(`Animating property '${propertyNameToAnimate}' is unsupported`);
					}
					break;
			}
		}
		let duration = 0.3;
		if (animation.duration !== undefined) {
			duration = animation.duration / 1000.0;
		}

		let delay = undefined;
		if (animation.delay) {
			delay = animation.delay / 1000.0;
		}

		let repeatCount = undefined;
		if (animation.iterations !== undefined) {
			if (animation.iterations === Number.POSITIVE_INFINITY) {
				repeatCount = Number.MAX_VALUE;
			} else {
				repeatCount = animation.iterations;
			}
		}

		return {
			propertyNameToAnimate: propertyNameToAnimate,
			fromValue: fromValue,
			subPropertiesToAnimate: subPropertyNameToAnimate,
			toValue: toValue,
			duration: duration,
			repeatCount: repeatCount,
			delay: delay,
		};
	}

	protected _createNativeAnimation(propertyAnimations: Array<PropertyAnimation>, index: number, playSequentially: boolean) {
		const animationInfo = propertyAnimations[index];
		const args = this._getNativeAnimationArguments(animationInfo, true);
		const nativeView = <UIView>animationInfo.target.nativeViewProtected;
		if (nativeView?.layer) {
			let nativeAnimation;

			if (args.subPropertiesToAnimate) {
				nativeAnimation = this._createGroupAnimation(args, animationInfo);
			} else {
				nativeAnimation = this._createBasicAnimation(args, animationInfo);
			}

			const animationDelegate = AnimationDelegateImpl.initWithFinishedCallback(new WeakRef(this), animationInfo);
			nativeAnimation.setValueForKey(animationDelegate, 'delegate');

			nativeView.layer.addAnimationForKey(nativeAnimation, args.propertyNameToAnimate);

			let callback = undefined;
			if (index + 1 < propertyAnimations.length) {
				callback = this._createiOSAnimationFunction(propertyAnimations, index + 1, playSequentially);
				if (!playSequentially) {
					callback();
				} else {
					animationDelegate.nextAnimation = callback;
				}
			}
		}
	}

	protected _createGroupAnimation(args: AnimationInfo, animation: PropertyAnimation) {
		const groupAnimation = CAAnimationGroup.new();
		groupAnimation.duration = args.duration;
		if (args.repeatCount !== undefined) {
			groupAnimation.repeatCount = args.repeatCount;
		}
		if (args.delay !== undefined) {
			groupAnimation.beginTime = CACurrentMediaTime() + args.delay;
		}
		if (animation.curve !== undefined) {
			groupAnimation.timingFunction = animation.curve;
		}
		const animations = NSMutableArray.alloc<CAAnimation>().initWithCapacity(3);

		args.subPropertiesToAnimate.forEach((property) => {
			const basicAnimationArgs = { ...args, duration: undefined, repeatCount: undefined, delay: undefined, curve: undefined };
			basicAnimationArgs.propertyNameToAnimate = `${args.propertyNameToAnimate}.${property}`;
			basicAnimationArgs.fromValue = args.fromValue[property];
			basicAnimationArgs.toValue = args.toValue[property];

			const basicAnimation = this._createBasicAnimation(basicAnimationArgs, animation);
			animations.addObject(basicAnimation);
		});

		groupAnimation.animations = animations;

		return groupAnimation;
	}

	protected _createBasicAnimation(args: AnimationInfo, animation: PropertyAnimation) {
		const basicAnimation = (animation.curve === 'spring' ? CASpringAnimation : CABasicAnimation).animationWithKeyPath(args.propertyNameToAnimate);
		basicAnimation['damping'] = 0.2;
		basicAnimation.fromValue = args.fromValue;
		basicAnimation.toValue = args.toValue;
		basicAnimation.duration = args.duration;
		if (args.repeatCount !== undefined) {
			basicAnimation.repeatCount = args.repeatCount;
		}
		if (args.delay !== undefined) {
			basicAnimation.beginTime = CACurrentMediaTime() + args.delay;
		}
		if (animation.curve !== undefined) {
			basicAnimation.timingFunction = animation.curve;
		}

		return basicAnimation;
	}
	usePropertyAnimator = false;
	protected _createNativeUIViewAnimation(propertyAnimations: Array<PropertyAnimationInfo>, index: number, playSequentially: boolean, animationInfo: PropertyAnimationInfo) {
		const args = this._getNativeAnimationArguments(animationInfo);
		const nativeView = <UIView>animationInfo.target.nativeViewProtected;

		let callback = undefined;
		let nextAnimation;
		if (index + 1 < propertyAnimations.length) {
			callback = this._createiOSAnimationFunction(propertyAnimations, index + 1, playSequentially);
			if (!playSequentially) {
				callback();
			} else {
				nextAnimation = callback;
			}
		}

		let delay = 0;
		if (args.delay) {
			delay = args.delay;
		}

		const isSpring = animationInfo.curve === 'spring';
		const animationOptions = UIViewAnimationOptions.AllowUserInteraction;

		const animate = () => {
			if (args.repeatCount !== undefined) {
				UIView.setAnimationRepeatCount(args.repeatCount);
			}
			const setKeyFrame = this._valueSource === 'keyframe';
			switch (animationInfo.propertyName) {
				case _transform:
					animationInfo._originalValue = nativeView.layer.transform;
					nativeView.layer.setValueForKey(args.toValue, args.propertyNameToAnimate);
					animationInfo._propertyResetCallback = function (value) {
						nativeView.layer.transform = value;
					};
					break;
				default:
					applyAnimationProperty(animationInfo.target, animationInfo.property, animationInfo.value, setKeyFrame);
					if (animationInfo.property.affectsLayout) {
						(animationInfo.target.page || animationInfo.target).nativeViewProtected.layoutIfNeeded();
					}
					break;
			}
		};
		const finish = (animationDidFinish: boolean) => {
			if (animationDidFinish) {
				if (animationInfo.propertyName === _transform) {
					if (animationInfo.value[Properties.translate] !== undefined) {
						animationInfo.target.translateX = animationInfo.value[Properties.translate].x;
						animationInfo.target.translateY = animationInfo.value[Properties.translate].y;
					}
					if (animationInfo.value[Properties.rotate] !== undefined) {
						animationInfo.target.rotateX = animationInfo.value[Properties.rotate].x;
						animationInfo.target.rotateY = animationInfo.value[Properties.rotate].y;
						animationInfo.target.rotate = animationInfo.value[Properties.rotate].z;
					}
					if (animationInfo.value[Properties.scale] !== undefined) {
						animationInfo.target.scaleX = animationInfo.value[Properties.scale].x;
						animationInfo.target.scaleY = animationInfo.value[Properties.scale].y;
					}
				}
			} else {
				if (animationInfo._propertyResetCallback) {
					animationInfo._propertyResetCallback(animationInfo._originalValue);
				}
			}
			const cancelled = !animationDidFinish;
			this.animationFinishedCallback(cancelled);
			if (animationDidFinish && nextAnimation && !this._wasCancelled) {
				nextAnimation();
			}
		};
		if (this.usePropertyAnimator) {
			const finishCallback = (position: UIViewAnimatingPosition) => finish(position === UIViewAnimatingPosition.End);
			if (isSpring) {
				const animator = UIViewPropertyAnimator.alloc().initWithDurationDampingRatioAnimations(args.duration, 0.2, null);
				animator.manualHitTestingEnabled = true;
				animator.addAnimations(animate);
				animator.addCompletion(finishCallback);
				// for seems to be the only way to use a timeout. It is not too bad but would be better to be handled natively
				// for this example this breaks slow animations in debugger
				if (args.delay) {
					setTimeout(() => {
						animator.startAnimation();
					}, args.delay * 1000);
				} else {
					animator.startAnimation();
				}
			} else {
				CATransaction.begin();
				CATransaction.setAnimationTimingFunction(animationInfo.curve);
				UIViewPropertyAnimator.runningPropertyAnimatorWithDurationDelayOptionsAnimationsCompletion(args.duration, args.delay, animationOptions, animate, finishCallback);
				CATransaction.commit();
			}
		} else {
			if (isSpring) {
				UIView.animateWithDurationDelayUsingSpringWithDampingInitialSpringVelocityOptionsAnimationsCompletion(args.duration, delay, 0.2, 0, UIViewAnimationOptions.CurveLinear | animationOptions, animate, finish);
			} else {
				CATransaction.begin();
				CATransaction.setAnimationTimingFunction(animationInfo.curve);
				UIView.animateWithDurationDelayOptionsAnimationsCompletion(args.duration, delay, animationOptions, animate, finish);
				CATransaction.commit();
			}
		}
	}

	protected static _createNativeAffineTransform(animation: PropertyAnimation): CATransform3D {
		const value = animation.value;
		let result: CATransform3D = CATransform3DIdentity;

		if (value[Properties.translate] !== undefined) {
			const x = value[Properties.translate].x;
			const y = value[Properties.translate].y;
			result = CATransform3DTranslate(result, x, y, 0);
		}

		if (value[Properties.scale] !== undefined) {
			const x = value[Properties.scale].x || 1e-6;
			const y = value[Properties.scale].y || 1e-6;
			result = CATransform3DScale(result, x, y, 1);
		}
		if (value[Properties.rotate] !== undefined) {
			const x = value[Properties.rotate].x;
			const y = value[Properties.rotate].y;
			const z = value[Properties.rotate].z;
			const perspective = animation.target.perspective || 300;
			// Only set perspective if there is 3D rotation
			if (x || y) {
				result.m34 = -1 / perspective;
			}
			result = iOSNativeHelper.applyRotateTransform(result, x, y, z);
		}

		return result;
	}

	protected static _isAffineTransform(property: string): boolean {
		return property === _transform || property === Properties.translate || property === Properties.rotate || property === Properties.scale;
	}

	protected static _canBeMerged(animation1: PropertyAnimation, animation2: PropertyAnimation) {
		const result = Animation._isAffineTransform(animation1.propertyName) && Animation._isAffineTransform(animation2.propertyName) && animation1.target === animation2.target && animation1.duration === animation2.duration && animation1.delay === animation2.delay && animation1.iterations === animation2.iterations && animation1.curve === animation2.curve;

		return result;
	}

	protected static _mergeAffineTransformAnimations(propertyAnimations: Array<PropertyAnimation>): Array<PropertyAnimation> {
		const result = new Array<PropertyAnimation>();

		let i = 0;
		let j;
		const length = propertyAnimations.length;
		for (; i < length; i++) {
			if (propertyAnimations[i][_skip]) {
				continue;
			}

			if (!Animation._isAffineTransform(propertyAnimations[i].propertyName)) {
				// This is not an affine transform animation, so there is nothing to merge.
				result.push(propertyAnimations[i]);
			} else {
				// This animation has not been merged anywhere. Create a new transform animation.
				// The value becomes a JSON object combining all affine transforms together like this:
				// {
				//    translate: {x: 100, y: 100 },
				//    rotate: 90,
				//    scale: {x: 2, y: 2 }
				// }
				const newTransformAnimation: PropertyAnimation = {
					target: propertyAnimations[i].target,
					propertyName: _transform,
					property: null,
					value: {},
					duration: propertyAnimations[i].duration,
					delay: propertyAnimations[i].delay,
					iterations: propertyAnimations[i].iterations,
					curve: propertyAnimations[i].curve,
				};
				if (Trace.isEnabled()) {
					Trace.write('Curve: ' + propertyAnimations[i].curve, Trace.categories.Animation);
				}
				newTransformAnimation.value[propertyAnimations[i].propertyName] = propertyAnimations[i].value;
				if (Trace.isEnabled()) {
					Trace.write('Created new transform animation: ' + Animation._getAnimationInfo(newTransformAnimation), Trace.categories.Animation);
				}

				// Merge all compatible affine transform animations to the right into this new animation.
				j = i + 1;
				if (j < length) {
					for (; j < length; j++) {
						if (Animation._canBeMerged(propertyAnimations[i], propertyAnimations[j])) {
							if (Trace.isEnabled()) {
								Trace.write('Merging animations: ' + Animation._getAnimationInfo(newTransformAnimation) + ' + ' + Animation._getAnimationInfo(propertyAnimations[j]) + ';', Trace.categories.Animation);
							}
							newTransformAnimation.value[propertyAnimations[j].propertyName] = propertyAnimations[j].value;
							// Mark that it has been merged so we can skip it on our outer loop.
							propertyAnimations[j][_skip] = true;
						}
					}
				}

				result.push(newTransformAnimation);
			}
		}

		return result;
	}
}

export function _getTransformMismatchErrorMessage(view: View): string {
	const expectedTransform = calculateTransform(view);
	const expectedTransformString = getCATransform3DString(expectedTransform);
	const actualTransformString = getCATransform3DString(view.nativeViewProtected.layer.transform);

	if (actualTransformString !== expectedTransformString) {
		return 'View and Native transforms do not match.\nActual: ' + actualTransformString + ';\nExpected: ' + expectedTransformString;
	}

	return undefined;
}

function calculateTransform(view: View): CATransform3D {
	const scaleX = view.scaleX || 1e-6;
	const scaleY = view.scaleY || 1e-6;
	const perspective = view.perspective || 300;

	// Order is important: translate, rotate, scale
	let expectedTransform = new CATransform3D(CATransform3DIdentity);

	// Only set perspective if there is 3D rotation
	if (view.rotateX || view.rotateY) {
		expectedTransform.m34 = -1 / perspective;
	}

	expectedTransform = CATransform3DTranslate(expectedTransform, view.translateX, view.translateY, 0);
	expectedTransform = iOSNativeHelper.applyRotateTransform(expectedTransform, view.rotateX, view.rotateY, view.rotate);
	expectedTransform = CATransform3DScale(expectedTransform, scaleX, scaleY, 1);

	return expectedTransform;
}

function getCATransform3DString(t: CATransform3D) {
	return `[
    ${t.m11}, ${t.m12}, ${t.m13}, ${t.m14},
    ${t.m21}, ${t.m22}, ${t.m23}, ${t.m24},
    ${t.m31}, ${t.m32}, ${t.m33}, ${t.m34},
    ${t.m41}, ${t.m42}, ${t.m43}, ${t.m44}]`;
}
