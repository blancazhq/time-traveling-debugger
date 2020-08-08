import { parse } from "../parser";
import { BoundingBox, TextMeasurer } from "./fit-box";
import { ZoomRenderable } from "./zui";
import { HistoryEntry } from "./play-lang";
import { CodeScopeRenderer } from "./code-scope-renderer";

type Scope = {
    bbox: BoundingBox,
    renderable: ZoomRenderable
};

type HoverStateEntry = {
    renderableId: string,
    bbox: BoundingBox
};

export function initZoomDebugger(element: HTMLElement, code: string, history: HistoryEntry[]) {
    const canvasWidth = element.offsetWidth * 2;
    const canvasHeight = element.offsetHeight * 2;
    if (canvasWidth === 0 || canvasHeight === 0) {
        throw new Error(`Container element has 0 dimension.`);
    }
    let mouseX: number;
    let mouseY: number;
    let dragging = false;
    let dragStartX: number;
    let dragStartY: number;
    let rootHoverState: HoverStateEntry[] = [];
    const ast = parse(code);
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvas.style.backgroundColor = "white";
    canvas.style.border = "1px solid black";
    canvas.style.transform = `scale(0.5) translate(-${canvas.width / 2}px, -${canvas.height / 2}px)`;
    canvas.style.cursor = "crosshair";
    let viewport = {
        top: - canvas.height / 2,
        left: - canvas.width / 2,
        zoom: 0.5
    };
    
    const ctx = canvas.getContext("2d");

    element.appendChild(canvas);
    ctx.textBaseline = "top";
    const textMeasurer = new TextMeasurer(ctx, true);
    
    const mainScope: Scope = {
        bbox: {
            y: 0,
            x: 0,
            width: canvas.width,
            height: canvas.height
        },
        renderable: new CodeScopeRenderer(history, ast, "main()", ast, code, textMeasurer)
    };
    
    let currentScopeChain: Scope[] = [mainScope];
    // Scope chain looks like [inner most, middle scope, outer most]

    requestRender();
    
    element.addEventListener("mousedown", (e: MouseEvent) => {
        dragging = true;
        dragStartX = e.offsetX;
        dragStartY = e.offsetY;
    });

    element.addEventListener("mouseup", () => {
        dragging = false;
    });

    element.addEventListener("mousemove", (e: MouseEvent) => {
        mouseX = e.offsetX;
        mouseY = e.offsetY; 
        if (dragging) {
            const pointerX = e.offsetX;
            const pointerY = e.offsetY;
            const [worldPointerX, worldPointerY] = pointCanvasToWorld(pointerX, pointerY);
            const [worldDragStartX, worldDragStartY] = pointCanvasToWorld(dragStartX, dragStartY);
            viewport.left -= worldPointerX - worldDragStartX;
            viewport.top -= worldPointerY - worldDragStartY;
            dragStartX = pointerX;
            dragStartY = pointerY;
            requestRender();
        }
        requestRender();
    });
    
    element.addEventListener("wheel", function (e: any) {
        e.preventDefault();
        const delta = e.deltaY;
        const pointerX = e.offsetX;
        const pointerY = e.offsetY;
        const newZoom = Math.max(0.5, viewport.zoom * (1 - delta * 0.01));

        const [worldPointerX, worldPointerY] = pointCanvasToWorld(pointerX, pointerY);
        const newLeft = - (pointerX / newZoom - worldPointerX);
        const newTop = - (pointerY / newZoom - worldPointerY);
        const newViewport = {
            top: newTop,
            left: newLeft,
            zoom: newZoom
        };
        viewport = newViewport;
        
        requestRender();
      }, { passive: false });

    function requestRender() {
        requestAnimationFrame(render);
    }
    
    function entirelyContainsViewport(bbox: BoundingBox) {
        return bbox.x <= 0 && bbox.y <= 0 &&
            (bbox.x + bbox.width > canvasWidth) && 
            (bbox.y + bbox.height > canvasHeight);
    }
    
    function bboxContains(bbox: BoundingBox, x: number, y: number) {
        return x >= bbox.x && y >= bbox.y && x <= bbox.x + bbox.width && y <= bbox.y + bbox.height;
    }
    
    function renderZoomRenderable(
        renderable: ZoomRenderable, 
        bbox: BoundingBox,
        hoverState: HoverStateEntry[],
        ancestry: Scope[]
    ): Scope[] | null {
        const viewportBBox = { x: 0, y: 0, width: canvas.width, height: canvas.height };
        // QUESTIONABLE CODE: update bbox
        for (let hoverEntry of rootHoverState) {
            if (hoverEntry.renderableId === renderable.id()) {
                hoverEntry.bbox = bbox;
            }
        }
        const childRenderables = renderable.render(ctx, bbox, viewportBBox, mouseX, mouseY);
        let childEnclosingRenderable: Scope[] | null = null;
        const myScope = {
            bbox: boxCanvasToWorld(bbox),
            renderable
        };
        
        let hoveredChild: ZoomRenderable;
        let hoveredChildBBox: BoundingBox;
        let nextHoverState: HoverStateEntry[];
        
        for (let [childBBox, renderable] of childRenderables.entries()) {
            let debug = renderable.id() === "scope[4,82,92]";
            if (debug) {
                console.log("scan child scope[4,82,92]");
            }
            if (isHovered(hoverState, renderable)) {
                if (debug) {
                    console.log("isHovered", renderable.id());
                }
                
                hoveredChild = renderable;
                hoveredChildBBox = getBBoxForHovered(childBBox);
                nextHoverState = hoverState.slice(1);
            } else if (hoverState.length === 0 && bboxContains(childBBox, mouseX, mouseY)) {
                if (debug) {
                    console.log(`Adding ${renderable.id()} to hover state`);
                }
                hoveredChild = renderable;
                hoveredChildBBox = getBBoxForHovered(childBBox);
                const hse = {
                    renderableId: renderable.id(),
                    bbox: hoveredChildBBox
                };
                nextHoverState = [];
                rootHoverState.push(hse);
            } else {
                if (debug) {
                    console.log("else");
                }
                const result = renderZoomRenderable(renderable, childBBox, hoverState, [myScope, ...ancestry]);
                if (result) {
                    childEnclosingRenderable = result;
                }
            }
        }
        
        if (hoveredChild) {
            const result = renderZoomRenderable(hoveredChild, hoveredChildBBox, nextHoverState, [myScope, ...ancestry]);
            if (result) {
                childEnclosingRenderable = result;
            }
        }
        
        if (childEnclosingRenderable) {
            return childEnclosingRenderable;
        } else {
            if (entirelyContainsViewport(bbox)) {
                return [myScope, ...ancestry];
            } else {
                return null;
            }
        }
    }
    
    function isHovered(hoverState: HoverStateEntry[], renderable: ZoomRenderable): boolean {
        return hoverState.length > 0 && hoverState[0].renderableId === renderable.id();
    }
    
    function isMouseOnHovered(hoverState: HoverStateEntry[], mouseX: number, mouseY: number): boolean {
        return !!hoverState.find(entry => bboxContains(entry.bbox, mouseX, mouseY));
    }
    
    function getBBoxForHovered(bbox: BoundingBox): BoundingBox {
        const width = bbox.width * 2;
        const height = bbox.height * 2;
        const biggerBBox = {
            x: bbox.x - (width - bbox.width) / 2,
            y: bbox.y - (height - bbox.height) / 2,
            width: width,
            height: height
        };
        return biggerBBox;
    }
    
    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const currentScope = currentScopeChain[0];
        const bBox = boxWorldToCanvas(currentScope.bbox);
        for (let i = rootHoverState.length - 1; i >= 0; i--) {
            const entry = rootHoverState[i];
            if (bboxContains(entry.bbox, mouseX, mouseY)) {
                break;
            } else {
                //console.log("pop rootHoverState");
                rootHoverState.pop();
            }
        }
        let hoverState = rootHoverState;
        console.log("rootHoverState", rootHoverState, "currentScope", currentScope.renderable.id());
        const enclosingScopeChain = renderZoomRenderable(currentScope.renderable, bBox, hoverState, currentScopeChain.slice(1));
        if (enclosingScopeChain) {
            currentScopeChain = enclosingScopeChain;
        } else {
            if (currentScopeChain.length > 1) {
                currentScopeChain = currentScopeChain.slice(1);
            } else {
                currentScopeChain = [mainScope];
            }
        }
    }
    
    function pointCanvasToWorld(x: number, y: number): [number, number] {
        return [
            x / viewport.zoom + viewport.left,
            y / viewport.zoom + viewport.top
        ];
    }

    function boxWorldToCanvas(box: BoundingBox): BoundingBox {
        return {
            y: (box.y - viewport.top) * viewport.zoom,
            x: (box.x - viewport.left) * viewport.zoom,
            width: box.width * viewport.zoom,
            height: box.height * viewport.zoom
        };
    }
    
    function boxCanvasToWorld(box: BoundingBox): BoundingBox {
        return {
            y: (box.y / viewport.zoom) + viewport.top,
            x: (box.x / viewport.zoom) + viewport.left,
            width: box.width / viewport.zoom,
            height: box.height / viewport.zoom
        };
    }
    
}
