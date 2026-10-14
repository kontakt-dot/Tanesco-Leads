import { useEffect } from "react";
import { normalizeLeadOperationsTerminology } from "@/lib/leadOpsTerminology";

function normalizeTextNodes(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach((node) => {
    const parent = node.parentElement;
    if (!parent || ["SCRIPT", "STYLE", "CODE", "PRE"].includes(parent.tagName)) return;
    const normalized = normalizeLeadOperationsTerminology(node.nodeValue ?? "");
    if (normalized !== node.nodeValue) node.nodeValue = normalized;
  });
  const attributes = ["aria-label", "placeholder", "title"];
  if (!(root instanceof Element)) return;
  root.querySelectorAll<HTMLElement>("*").forEach((element) => {
    attributes.forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (!value) return;
      const normalized = normalizeLeadOperationsTerminology(value);
      if (normalized !== value) element.setAttribute(attribute, normalized);
    });
  });
}

export default function LeadOperationsTerminologyGuard() {
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    const normalize = () => normalizeTextNodes(root);
    normalize();
    const observer = new MutationObserver(normalize);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
