import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ProductDemo } from "./product-demo";

describe("ProductDemo", () => {
  afterEach(cleanup);

  it("makes the agent state understandable without relying on motion", async () => {
    const user = userEvent.setup();

    render(<ProductDemo />);
    expect(
      screen.getByRole("region", { name: "Vista previa del centro de control Niki" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Niki está escuchando")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Pensar" }));

    expect(screen.getByLabelText("Niki está pensando")).toBeVisible();
    expect(screen.getByText("Conecta lo que dijiste con el contexto que ya elegiste guardar.")).toBeVisible();
  });
});
