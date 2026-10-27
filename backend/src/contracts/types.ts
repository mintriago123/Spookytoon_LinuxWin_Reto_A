// Proyección de SPEC.md §2.2. Agregar los DTO del motor al implementar routing.
export type Zone = "Tarqui" | "Los Esteros" | "Barbasquillo" | "Jocay";
export type RoadType = "avenida" | "calle" | "callejon" | "puente";
export interface GraphNode { id: string; lat: number; lng: number; zona: Zone }
export interface GraphEdge {
  id: string; segmentoId: string; origen: string; destino: string;
  distancia_m: number; tipo: RoadType; factor_velocidad: number;
}
export interface GraphShelter { id: string; nodoId: string; capacidad: number }
export interface MantaGraph {
  schemaVersion: "1.0.0";
  metadata: {
    ciudad: "Manta"; graphVersion: string; generatedAt: string;
    source: "OpenStreetMap"; osmAttribution: string;
  };
  nodos: GraphNode[]; aristas: GraphEdge[]; refugios: GraphShelter[];
}
