"use client";

import { useEffect, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";

type SigmaNodeEvent = {
  node: string;
  event: {
    preventSigmaDefault: () => void;
    original: MouseEvent | TouchEvent;
  };
};

type Node = {
  id: string;
  title: string;
  content: string;
  edgesFrom: Array<{
    id: string;
    type: string;
    fromNodeId: string;
    toNodeId: string;
  }>;
  edgesTo: Array<{
    id: string;
    type: string;
    fromNodeId: string;
    toNodeId: string;
  }>;
  createdAt: Date;
};

type GraphViewProps = {
  nodes: Node[];
  onNodeClick: (nodeId: string, x: number, y: number) => void;
  onNodeHover: (nodeId: string | null, x: number, y: number) => void;
  onEmptyDoubleClick: (x: number, y: number) => void;
  isLinkMode?: boolean;
  linkFromNodeId?: string | null;
  onLinkTargetClick?: (targetNodeId: string) => void;
};

export default function GraphView({
  nodes,
  onNodeClick,
  onNodeHover,
  onEmptyDoubleClick,
  isLinkMode = false,
  linkFromNodeId = null,
  onLinkTargetClick,
}: GraphViewProps) {
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const lastClickTimeRef = useRef<number>(0);
  const lastClickNodeRef = useRef<string | null>(null);
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hoveredNodeRef = useRef<string | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const cameraStateRef = useRef<{ x: number; y: number; ratio: number } | null>(
    null
  );

  useEffect(() => {
    if (!containerRef.current || sigmaRef.current) return;

    const graph = new Graph();
    graphRef.current = graph;

    const sigma = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false,
      defaultNodeColor: "#5D0E41",
      defaultEdgeColor: "#00224D",
      labelColor: { color: "#E5E7EB" },
      labelSize: 15,
      labelWeight: "400",
      labelFont: "Inter, system-ui, sans-serif",
      enableEdgeEvents: true,
      allowInvalidContainer: true,
      labelRenderedSizeThreshold: 0,
      zIndex: true,
    });

    sigma.setSetting("nodeReducer", (node, data) => {
      return {
        ...data,
        color: data.color,
        label: data.hovered ? "" : data.label,
      };
    });

    sigmaRef.current = sigma;

    sigma.getCamera().on("updated", () => {
      onNodeHover(null, 0, 0);
    });

    return () => {};
  }, []);

  const currentStateRef = useRef({ isLinkMode, linkFromNodeId });
  useEffect(() => {
    currentStateRef.current = { isLinkMode, linkFromNodeId };
  }, [isLinkMode, linkFromNodeId]);

  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;

    sigma.removeAllListeners("clickNode");
    sigma.removeAllListeners("enterNode");
    sigma.removeAllListeners("leaveNode");

    const handleClickNode = ({ node, event }: SigmaNodeEvent) => {
      event.preventSigmaDefault();
      const { isLinkMode, linkFromNodeId } = currentStateRef.current;

      if (isLinkMode) {
        if (onLinkTargetClick && node !== linkFromNodeId) {
          setSelectedTarget(node);
          onLinkTargetClick(node);
        }
        return;
      }

      const now = Date.now();
      const isDoubleClick =
        lastClickNodeRef.current === node &&
        now - lastClickTimeRef.current < 300;

      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }

      if (isDoubleClick) {
        lastClickTimeRef.current = 0;
        lastClickNodeRef.current = null;
      } else {
        lastClickTimeRef.current = now;
        lastClickNodeRef.current = node;

        clickTimeoutRef.current = setTimeout(() => {
          if (graph.hasNode(node)) {
            const attrs = graph.getNodeAttributes(node);
            const coords = sigma.graphToViewport({
              x: attrs.x as number,
              y: attrs.y as number,
            });
            onNodeClick(node, coords.x, coords.y);
          }
          lastClickTimeRef.current = 0;
          lastClickNodeRef.current = null;
        }, 250);
      }
    };

    const handleEnterNode = ({ node }: { node: string }) => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }

      if (!graph.hasNode(node)) return;

      hoveredNodeRef.current = node;
      graph.setNodeAttribute(node, "hovered", true);

      let hoverColor = "#8B1A5F";
      const { isLinkMode, linkFromNodeId } = currentStateRef.current;

      if (isLinkMode && node !== linkFromNodeId) {
        hoverColor = "#FFD700";
      } else if (!isLinkMode) {
        const original = graph.getNodeAttribute(node, "originalColor");
        hoverColor = lightenColor(original);
      }

      graph.setNodeAttribute(node, "color", hoverColor);
      containerRef.current!.style.cursor =
        isLinkMode && node !== linkFromNodeId ? "crosshair" : "pointer";

      const attrs = graph.getNodeAttributes(node);
      const coords = sigma.graphToViewport({
        x: attrs.x as number,
        y: attrs.y as number,
      });
      onNodeHover(node, coords.x, coords.y);

      sigma.refresh();
    };

    const handleLeaveNode = ({ node }: { node: string }) => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }

      if (!graph.hasNode(node)) return;

      hoveredNodeRef.current = null;
      graph.setNodeAttribute(node, "hovered", false);

      const original = graph.getNodeAttribute(node, "originalColor");
      let restoreColor = original;
      const { isLinkMode } = currentStateRef.current;

      if (isLinkMode && node === selectedTarget) {
        restoreColor = "#FFD700";
      }

      graph.setNodeAttribute(node, "color", restoreColor);
      containerRef.current!.style.cursor = "default";
      onNodeHover(null, 0, 0);

      sigma.refresh();
    };

    sigma.on("clickNode", handleClickNode);
    sigma.on("enterNode", handleEnterNode);
    sigma.on("leaveNode", handleLeaveNode);

    return () => {
      sigma.removeListener("clickNode", handleClickNode);
      sigma.removeListener("enterNode", handleEnterNode);
      sigma.removeListener("leaveNode", handleLeaveNode);
    };
  }, [
    selectedTarget,
    nodes,
    isLinkMode,
    linkFromNodeId,
    onNodeClick,
    onNodeHover,
    onLinkTargetClick,
  ]);

  useEffect(() => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma || nodes.length === 0) return;

    // Save current camera state before rebuilding - BUT ONLY IF IT'S NOT DEFAULT
    const camera = sigma.getCamera();
    const currentState = camera.getState();

    // Only save if we have a valid non-default state AND it was previously set
    if (
      cameraStateRef.current !== null &&
      currentState.ratio !== 1 &&
      currentState.x !== 0.5 &&
      currentState.y !== 0.5
    ) {
      cameraStateRef.current = currentState;
    } else {
    }

    graph.clear();

    const childrenMap = new Map<string, string[]>();
    const rootNodes = new Set(nodes.map((n) => n.id));

    nodes.forEach((node) => {
      node.edgesFrom.forEach((edge) => {
        if (!childrenMap.has(edge.fromNodeId)) {
          childrenMap.set(edge.fromNodeId, []);
        }
        childrenMap.get(edge.fromNodeId)!.push(edge.toNodeId);
        rootNodes.delete(edge.toNodeId);
      });
    });

    const positions = new Map<string, { x: number; y: number }>();
    const visited = new Set<string>();

    // Separate nodes by type, NOTE: done for the purpose to later identify different notes on the graph
    const hierarchyNodes = new Set<string>();
    const specialNodes = new Map<string, { parentId: string; type: string }>();

    // Identify hierarchy vs special nodes
    nodes.forEach((node) => {
      let isSpecial = false;
      node.edgesTo.forEach((edge) => {
        if (
          edge.type === "reference" ||
          edge.type === "example" ||
          edge.type === "contradiction"
        ) {
          specialNodes.set(node.id, {
            parentId: edge.fromNodeId,
            type: edge.type,
          });
          isSpecial = true;
        }
      });
      if (!isSpecial) {
        hierarchyNodes.add(node.id);
      }
    });

    // Calculate subtree widths for proper spacing; NOTE: otherwise, the tree will be able to get "F***** up", because some edges will be overlapping the other edges
    // short language: basically one edge will have the same x, y coordinates with another edge
    const getSubtreeWidth = (nodeId: string): number => {
      const children = (childrenMap.get(nodeId) || []).filter((id) =>
        hierarchyNodes.has(id)
      );

      // Count special nodes attached to this node
      const specialCount = Array.from(specialNodes.entries()).filter(
        ([_, data]) => data.parentId === nodeId
      ).length;

      // Add extra width if this node has special nodes around it
      const specialWidth = specialCount > 0 ? 1.5 : 1;

      if (children.length === 0) return specialWidth;

      const childrenWidth = children.reduce(
        (sum, childId) => sum + getSubtreeWidth(childId),
        0
      );

      return Math.max(childrenWidth, specialWidth);
    };

    // Layout hierarchy nodes in tree structure; NOTE: the idea goes from Zettlekasten and mindmaps combined, kindaof
    const layoutTree = (
      id: string,
      depth: number,
      leftBound: number,
      rightBound: number
    ) => {
      if (visited.has(id) || !hierarchyNodes.has(id)) return;
      visited.add(id);

      const centerX = (leftBound + rightBound) / 2;
      const y = depth * 250 + 100;
      positions.set(id, { x: centerX, y });

      const children = (childrenMap.get(id) || []).filter((cid) =>
        hierarchyNodes.has(cid)
      );
      if (children.length === 0) return;

      const childWidths = children.map((cid) => getSubtreeWidth(cid));
      const totalWidth = childWidths.reduce((a, b) => a + b, 0);

      // Minimum spacing between nodes to avoid overlap
      const minNodeSpacing = 300;
      const availableWidth = rightBound - leftBound;
      const requiredWidth = totalWidth * minNodeSpacing; // REVIEW: not anymore needed

      // Use the larger of calculated spacing or minimum spacing
      const actualSpacing = Math.max(
        availableWidth / totalWidth,
        minNodeSpacing
      );

      let currentX = leftBound;
      children.forEach((childId, i) => {
        const childWidth = childWidths[i];
        const childSpace = childWidth * actualSpacing;
        const childLeft = currentX;
        const childRight = currentX + childSpace;
        layoutTree(childId, depth + 1, childLeft, childRight);
        currentX = childRight;
      });
    };

    // Layout roots
    const roots = Array.from(rootNodes).filter((id) => hierarchyNodes.has(id));
    const treeSpacing = 800;
    roots.forEach((root, rootIndex) => {
      const width = getSubtreeWidth(root);
      const treeWidth = width * 250;
      const startX = rootIndex * treeSpacing;
      layoutTree(root, 0, startX - treeWidth / 2, startX + treeWidth / 2);
    });

    // Position special nodes around their parents, NOTE: very important, because otherwise, the layout might get "F***** up"
    const specialPositions = new Map<string, { x: number; y: number }>();

    specialNodes.forEach((info, nodeId) => {
      const parentPos = positions.get(info.parentId);
      if (!parentPos) return;

      // Count special nodes for this parent
      const siblingsOfType = Array.from(specialNodes.entries()).filter(
        ([_, data]) => data.parentId === info.parentId
      );
      const index = siblingsOfType.findIndex(([id]) => id === nodeId);

      // Arrange in circle around parent with enough spacing
      const radius = 120;
      const totalSiblings = siblingsOfType.length;

      // Start from top and go clockwise, REVIEW: the current small issue: at the count of 4 edges, there will be a link to the right
      // this link with the edge will overlap with the main node text, for example if x is the node
      //
      //                       should be: x title
      //                  how it appears: x --otle      REVIEW:
      const angleOffset = -Math.PI / 2;
      const angleStep = (Math.PI * 2) / totalSiblings;
      const angle = angleOffset + index * angleStep;

      const newPos = {
        x: parentPos.x + Math.cos(angle) * radius,
        y: parentPos.y + Math.sin(angle) * radius,
      };

      specialPositions.set(nodeId, newPos);
    });

    // Check for overlaps and adjust
    specialPositions.forEach((pos, nodeId) => {
      const adjusted = { ...pos };
      let hasOverlap = true;
      let attempts = 0;
      const maxAttempts = 10;

      while (hasOverlap && attempts < maxAttempts) {
        hasOverlap = false;

        // Check against all other positions
        for (const [otherId, otherPos] of positions.entries()) {
          if (otherId === nodeId) continue;

          const dx = adjusted.x - otherPos.x;
          const dy = adjusted.y - otherPos.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 100) {
            // Minimum distance between nodes
            hasOverlap = true;
            // Push away from overlapping node
            const pushAngle = Math.atan2(dy, dx);
            adjusted.x += Math.cos(pushAngle) * 50;
            adjusted.y += Math.sin(pushAngle) * 50;
          }
        }

        attempts++;
      }

      positions.set(nodeId, adjusted);
    });

    nodes.forEach((node) => {
      const pos = positions.get(node.id) ?? {
        x: Math.random() * 800,
        y: Math.random() * 800,
      };

      const specialInfo = Array.from(specialNodes.entries()).find(
        ([id]) => id === node.id
      );

      let color = "#5D0E41";

      if (specialInfo) {
        const [_, info] = specialInfo;
        if (info.type === "example") color = "#00D9FF";
        else if (info.type === "contradiction") color = "#FFB800";
        else if (info.type === "reference") color = "#64F991";
      } else {
        const connections =
          node.edgesFrom.filter(
            (e) => !["reference", "example", "contradiction"].includes(e.type)
          ).length +
          node.edgesTo.filter(
            (e) => !["reference", "example", "contradiction"].includes(e.type)
          ).length;

        if (connections > 5) color = "#FF204E";
        else if (connections > 2) color = "#A0153E";
      }

      // Override for selection states
      if (isLinkMode && node.id === linkFromNodeId) {
        color = "#FFFFFF"; // Pure white
      } else if (isLinkMode && node.id === selectedTarget) {
        color = "#FFD700"; // Bright gold
      } else if (!isLinkMode && node.id === linkFromNodeId) {
        color = "#FFFFFF"; // Pure white
      }

      const isSpecialNode = specialNodes.has(node.id);
      const hierarchyConnections =
        node.edgesFrom.filter((e) => e.type === "parent").length +
        node.edgesTo.filter((e) => e.type === "parent").length;

      // Make selected/target nodes bigger
      let size = isSpecialNode
        ? 6
        : Math.min(15, Math.max(8, hierarchyConnections * 2 + 8));

      // Increase size for selected and target nodes
      if (
        (isLinkMode && node.id === linkFromNodeId) ||
        (isLinkMode && node.id === selectedTarget) ||
        (!isLinkMode && node.id === linkFromNodeId)
      ) {
        size = size * 1.8; // Make selected nodes 80% bigger
      }

      graph.addNode(node.id, {
        label: isSpecialNode ? "" : node.title,
        x: pos.x,
        y: pos.y,
        size: size,
        color,
        originalColor: color,
        hovered: false,
        zIndex: isSpecialNode ? 5 : 10, // Higher zIndex for hierarchy nodes
        forceLabel: !isSpecialNode,
      });
    });

    const seen = new Set<string>();
    nodes.forEach((node) => {
      node.edgesFrom.forEach((edge) => {
        const key = `${edge.fromNodeId}-${edge.toNodeId}`;
        if (!seen.has(key) && graph.hasNode(edge.toNodeId)) {
          const isSpecialEdge =
            edge.type === "reference" ||
            edge.type === "example" ||
            edge.type === "contradiction";
          graph.addEdge(edge.fromNodeId, edge.toNodeId, {
            size: isSpecialEdge ? 2.5 : 1.5,
            color: getEdgeColor(edge.type),
            zIndex: isSpecialEdge ? 3 : 1, // Lower than nodes
          });
          seen.add(key);
        }
      });
    });

    // Restore or set camera position - FORCE IT AFTER REFRESH
    if (cameraStateRef.current) {
      // Restore saved camera state
      camera.setState(cameraStateRef.current);
    } else {
      // Initial setup - calculate bounds
      let minX = Infinity,
        maxX = -Infinity;
      let minY = Infinity,
        maxY = -Infinity;

      graph.forEachNode((node, attrs) => {
        minX = Math.min(minX, attrs.x);
        maxX = Math.max(maxX, attrs.x);
        minY = Math.min(minY, attrs.y);
        maxY = Math.max(maxY, attrs.y);
      });

      const containerWidth = containerRef.current!.offsetWidth;
      const containerHeight = containerRef.current!.offsetHeight;

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const graphWidth = maxX - minX;
      const graphHeight = maxY - minY;

      const ratioX = graphWidth / containerWidth;
      const ratioY = graphHeight / containerHeight;
      const calculatedRatio = Math.max(ratioX, ratioY);

      const MIN_RATIO = 1.2; // Lower = more zoomed in
      const ZOOM_PADDING = 1.2; // Lower = more zoomed in

      const finalRatio = Math.max(calculatedRatio * ZOOM_PADDING, MIN_RATIO);

      const newState = {
        x: 0.5,
        y: 0.5,
        ratio: finalRatio,
      };

      camera.setState(newState);
      cameraStateRef.current = newState;
    }

    sigma.refresh();

    setTimeout(() => {
      if (cameraStateRef.current) {
        const currentCameraState = camera.getState();

        if (
          Math.abs(currentCameraState.ratio - cameraStateRef.current.ratio) >
          0.1
        ) {
          camera.setState(cameraStateRef.current);
          sigma.refresh();
        }
      }
    }, 100);
  }, [nodes, isLinkMode, linkFromNodeId, selectedTarget]);

  useEffect(() => {
    return () => {
      try {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
        if (sigmaRef.current) sigmaRef.current.kill();
      } catch (e) {
        console.error("Cleanup error:", e);
      }
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, []);

  if (nodes.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <button
          onClick={(e) => {
            onEmptyDoubleClick(window.innerWidth / 2, window.innerHeight / 2);
          }}
          className="px-8 py-4 bg-[#5D0E41] hover:bg-[#A0153E] text-white rounded-lg text-base font-medium transition-all duration-200 hover:shadow-lg"
        >
          Create First Node
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full bg-[#0A0A0F]">
      {isLinkMode && (
        <div className="absolute top-6 left-1/2 transform -translate-x-1/2 bg-[#12121A]/95 backdrop-blur-md border border-[#FFD700] rounded-lg px-6 py-3 z-40 shadow-2xl">
          <p className="text-sm text-[#FFD700] font-medium">
            Link Mode Active • Click a node to create connection
          </p>
        </div>
      )}
    </div>
  );
}

function getEdgeColor(type: string): string {
  switch (type) {
    case "parent":
      return "#FF6B9D";
    case "example":
      return "#00D9FF";
    case "contradiction":
      return "#FFB800";
    case "reference":
    default:
      return "#64F991";
  }
}

function lightenColor(color: string): string {
  const colors: { [key: string]: string } = {
    "#5D0E41": "#8B1A5F",
    "#A0153E": "#C91F51",
    "#FF204E": "#FF4D73",
  };
  return colors[color] || color;
}
