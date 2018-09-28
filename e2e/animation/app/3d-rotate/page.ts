import { EventData, Page } from "tns-core-modules/ui/page";
import { View } from "tns-core-modules/ui/core/view";
import { Point3D } from "tns-core-modules/ui/animation/animation";

let view: View;

export function pageLoaded(args: EventData) {
    const page = <Page>args.object;
    view = page.getViewById<View>("view");
}

export function onAnimateX(args: EventData) {
    rotate({ x: 60, y: 0, z: 0 });
}

export function onAnimateY(args: EventData) {
    rotate({ x: 0, y: 60, z: 0 });
}

export function onAnimateZ(args: EventData) {
    rotate({ x: 0, y: 0, z: 60 });
}

export function onAnimateXYZ(args: EventData) {
    rotate({ x: 60, y: 60, z: 60 });
}

function rotate(rotate: Point3D) {
    view.animate({
        rotate,
        duration: 1000
    }).then(reset);
}

function reset() {
    view.rotate = 0;
    view.rotateX = 0;
    view.rotateY = 0;
}
