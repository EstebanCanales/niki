import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Put } from "@nestjs/common";

import { AgentRuntimeService } from "./agent-runtime.service";

/**
 * Estado del runtime del agente y elección de proveedor.
 *
 * Es lo que le permite a la app mostrar si Niki está pensando con Kimi, con OpenAI o
 * con lo que sea, y cambiarlo sin editar YAML ni reiniciar nada a mano.
 */
@Controller("agent")
export class AgentController {
  constructor(
    @Inject(AgentRuntimeService)
    private readonly runtime: AgentRuntimeService,
  ) {}

  @Get("status")
  status() {
    return { ...this.runtime.status(), model: this.runtime.currentModel() };
  }

  @Get("providers")
  async providers() {
    const [providers, current] = await Promise.all([
      this.runtime.listProviders(),
      Promise.resolve(this.runtime.currentModel()),
    ]);
    return { providers, current };
  }

  /**
   * Arranca el inicio de sesión de un proveedor por suscripción.
   *
   * Abre el flujo del propio runtime en una Terminal, apuntado al HERMES_HOME de Niki:
   * es interactivo por naturaleza (hay que ver un código y aprobar en el navegador) y
   * cada proveedor tiene el suyo.
   */
  @Post("providers/:id/login")
  async login(@Param("id") id: string) {
    const known = await this.runtime.listProviders();
    const match = known.find((p) => p.id === id);
    if (!match) throw new BadRequestException(`Proveedor desconocido: ${id}`);
    if (match.authType === "api_key") {
      throw new BadRequestException(
        `${match.name} usa clave, no sesión. Definí ${match.apiKeyEnvVars.join(" o ")} en app/backend/.env.`,
      );
    }
    const r = await this.runtime.startProviderLogin(id);
    return { ok: true, ...r };
  }

  @Put("model")
  async setModel(@Body() body: { provider?: string; model?: string; baseUrl?: string }) {
    const provider = String(body?.provider ?? "").trim();
    const model = String(body?.model ?? "").trim();
    if (!provider || !model) {
      throw new BadRequestException("Hacen falta `provider` y `model`.");
    }

    // Solo se aceptan proveedores que el runtime conoce: escribir uno inventado en la
    // config deja al agente sin arrancar, y el error aparecería recién en el siguiente
    // turno, lejos de la causa.
    const known = await this.runtime.listProviders();
    const match = known.find((p) => p.id === provider);
    if (!match) {
      throw new BadRequestException(
        `Proveedor desconocido: ${provider}. Disponibles: ${known.map((p) => p.id).join(", ")}`,
      );
    }
    if (!match.credentialReady) {
      throw new BadRequestException(
        `${match.name} no tiene credencial. Definí ${match.apiKeyEnvVars.join(" o ")} en app/backend/.env.`,
      );
    }

    await this.runtime.setModel(provider, model, body?.baseUrl?.trim() || undefined);
    return { ok: true, ...this.runtime.currentModel() };
  }
}
