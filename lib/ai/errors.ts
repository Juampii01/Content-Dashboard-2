/** Error de la IA con un mensaje en español para mostrar (`userMessage`) y el detalle técnico para el log. */
export class AiError extends Error {
  constructor(
    readonly userMessage: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "AiError";
  }
}

/** Se llegó al tope de créditos de IA del mes (de la persona o de la instalación). */
export class AiCreditError extends AiError {
  constructor(userMessage: string, detail: string) {
    super(userMessage, detail);
    this.name = "AiCreditError";
  }
}
