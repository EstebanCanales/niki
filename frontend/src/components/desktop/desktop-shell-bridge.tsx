"use client";

import { isTauri } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef } from "react";

import { wrapperHeaders, wrapperUrl } from "@/core/runtime/wrapper";
import { sendChatTurn } from "@/features/chat/send-chat-turn";
import { useWorkspaceStore } from "@/stores/use-workspace-store";
import type { NotchChatRequest } from "@/types/niki";

export function DesktopShellBridge() {
  const notchSettings = useWorkspaceStore((s) => s.notchSettings);
  const setNotchStatus = useWorkspaceStore((s) => s.setNotchStatus);
  const backendBaseUrl = useWorkspaceStore((s) => s.backendBaseUrl);
  const backendApiKey = useWorkspaceStore((s) => s.backendApiKey);
  const userId = useWorkspaceStore((s) => s.userId);
  const sendingPromptRef = useRef(false);

  const sendNotchRequest = useCallback(async (request: NotchChatRequest) => {
    const prompt = request.text.trim();
    const files = request.files ?? [];
    if (!prompt && files.length === 0) {
      console.info("[notch] ignored empty request");
      return;
    }
    if (sendingPromptRef.current) {
      console.info("[notch] ignored request while another notch request is sending");
      return;
    }

    sendingPromptRef.current = true;
    try {
      console.info("[notch] delivering wrapper request to chat", {
        textChars: prompt.length,
        fileCount: files.length,
        createdAt: request.createdAt,
        sessionId: useWorkspaceStore.getState().activeChatSessionId,
      });
      await sendChatTurn({
        text: prompt,
        files,
        baseUrl: backendBaseUrl,
        apiKey: backendApiKey,
        userId,
        sessionId: useWorkspaceStore.getState().activeChatSessionId,
        channel: "niki-agent",
        messageIdPrefix: "notch",
      });
      console.info("[notch] request delivered to chat");
    } catch (error) {
      console.error("[notch] request send error", error);
    } finally {
      sendingPromptRef.current = false;
    }
  }, [backendApiKey, backendBaseUrl, userId]);

  useEffect(() => {
    if (!isTauri()) return;
    console.info("[notch] bridge starting", {
      enabled: notchSettings.enabled,
      width: notchSettings.expandedWidth,
      height: notchSettings.expandedHeight,
    });

    void (async () => {
      try {
        if (!notchSettings.enabled) {
          await invoke("close_boring_notch").catch(() => undefined);
          setNotchStatus({
            visible: false,
            effectiveWidth: notchSettings.expandedWidth,
            effectiveHeight: notchSettings.collapsedHeight,
            lastError: "",
          });
          return;
        }

        await invoke("close_boring_notch").catch(() => undefined);
        await invoke("launch_boring_notch");
        console.info("[notch] launch requested");
        setNotchStatus({
          visible: true,
          effectiveWidth: notchSettings.expandedWidth,
          effectiveHeight: notchSettings.expandedHeight,
          lastError: "",
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : JSON.stringify(error);
        setNotchStatus({
          visible: false,
          effectiveWidth: notchSettings.expandedWidth,
          effectiveHeight: notchSettings.collapsedHeight,
          lastError: message,
        });
        console.error("[notch] create error", message);
      }
    })();

    return () => {
      void invoke("close_boring_notch").catch(() => undefined);
    };
  }, [
    notchSettings.collapsedHeight,
    notchSettings.enabled,
    notchSettings.expandedHeight,
    notchSettings.expandedWidth,
    setNotchStatus,
  ]);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke("sync_notch_config", {
      baseUrl: backendBaseUrl,
      apiKey: backendApiKey,
      userId,
    })
      .then(() => {
        console.info("[notch] config synced to native notch", {
          backendBaseUrl,
          apiKeyChars: backendApiKey.trim().length,
          userId,
        });
      })
      .catch((error) => {
        console.error("[notch] config sync failed", error);
      });
  }, [backendApiKey, backendBaseUrl, userId]);

  useEffect(() => {
    if (!isTauri()) return;
    console.info("[notch] wrapper polling started");

    const interval = window.setInterval(() => {
      if (sendingPromptRef.current) {
        return;
      }

      const headers = wrapperHeaders(backendApiKey, {
        "content-type": "application/json",
      });
      if (userId.trim()) {
        headers.set("x-niki-user-id", userId.trim());
      }

      void fetch(wrapperUrl(backendBaseUrl, "/notch/consume"), {
        method: "POST",
        headers,
      })
        .then(async (response) => {
          if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(`consume failed (${response.status}): ${body}`);
          }
          return response.json() as Promise<{
            ok?: boolean;
            request?: NotchChatRequest | null;
          }>;
        })
        .then((payload) => {
          const request = payload?.request;
          if (!request) return;
          console.info("[notch] request pulled from wrapper", {
            textChars: String(request.text ?? "").length,
            fileCount: Array.isArray(request.files) ? request.files.length : 0,
            createdAt: request.createdAt,
          });
          void sendNotchRequest({
            text: request.text ?? "",
            files: Array.isArray(request.files) ? request.files : [],
            createdAt: request.createdAt ?? new Date().toISOString(),
          });
        })
        .catch((error) => {
          console.error("[notch] consume request failed", error);
        });
    }, 1000);

    return () => {
      console.info("[notch] wrapper polling stopped");
      window.clearInterval(interval);
    };
  }, [backendApiKey, backendBaseUrl, sendNotchRequest, userId]);

  return null;
}
