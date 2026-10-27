import { Endpoint } from "./endpoint.cjs";
//#region src/openapi.d.ts
type OpenAPISchemaType = "string" | "number" | "integer" | "boolean" | "array" | "object";
interface OpenAPIParameter {
  in: "query" | "path" | "header" | "cookie";
  name?: string | undefined;
  description?: string | undefined;
  required?: boolean | undefined;
  schema?: {
    type: OpenAPISchemaType;
    format?: string | undefined;
    items?: {
      type: OpenAPISchemaType;
    } | undefined;
    enum?: string[] | undefined;
    minLength?: number | undefined;
    description?: string | undefined;
    default?: string | undefined;
    example?: string | undefined;
  } | undefined;
}
interface Path {
  get?: {
    tags?: string[] | undefined;
    operationId?: string | undefined;
    description?: string | undefined;
    security?: [{
      bearerAuth: string[];
    }] | undefined;
    parameters?: OpenAPIParameter[] | undefined;
    responses?: { [key in string]: {
      description?: string | undefined;
      content: {
        "application/json": {
          schema: {
            type?: OpenAPISchemaType | undefined;
            properties?: Record<string, any> | undefined;
            required?: string[] | undefined;
            $ref?: string | undefined;
          };
        };
      };
    }; } | undefined;
  } | undefined;
  post?: {
    tags?: string[] | undefined;
    operationId?: string | undefined;
    description?: string | undefined;
    security?: [{
      bearerAuth: string[];
    }] | undefined;
    parameters?: OpenAPIParameter[] | undefined;
    requestBody?: {
      content: {
        "application/json": {
          schema: {
            type?: OpenAPISchemaType | undefined;
            properties?: Record<string, any> | undefined;
            required?: string[] | undefined;
            $ref?: string | undefined;
          };
        };
      };
    } | undefined;
    responses?: { [key in string]: {
      description?: string | undefined;
      content: {
        "application/json": {
          schema: {
            type?: OpenAPISchemaType | undefined;
            properties?: Record<string, any> | undefined;
            required?: string[] | undefined;
            $ref?: string | undefined;
          };
        };
      };
    }; } | undefined;
  } | undefined;
}
declare function generator(endpoints: Record<string, Endpoint>, config?: {
  url: string;
}): Promise<{
  openapi: string;
  info: {
    title: string;
    description: string;
    version: string;
  };
  components: {
    schemas: {};
  };
  security: {
    apiKeyCookie: never[];
  }[];
  servers: {
    url: string | undefined;
  }[];
  tags: {
    name: string;
    description: string;
  }[];
  paths: Record<string, Path>;
}>;
declare const getHTML: (apiReference: Record<string, any>, config?: {
  logo?: string;
  theme?: string;
  title?: string;
  description?: string;
}) => string;
//#endregion
export { OpenAPIParameter, OpenAPISchemaType, Path, generator, getHTML };
//# sourceMappingURL=openapi.d.cts.map