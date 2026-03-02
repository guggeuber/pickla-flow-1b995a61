import { ChevronDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface EventSelectorProps {
  events: Array<{ id: string; name: string; display_name?: string | null; format: string }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const EventSelector = ({ events, selectedId, onSelect }: EventSelectorProps) => {
  return (
    <Select value={selectedId ?? undefined} onValueChange={onSelect}>
      <SelectTrigger className="w-full glass-card border-border rounded-xl h-11">
        <SelectValue placeholder="Välj event" />
      </SelectTrigger>
      <SelectContent>
        {events.map((event) => (
          <SelectItem key={event.id} value={event.id}>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{event.display_name || event.name}</span>
              <span className="text-xs text-muted-foreground capitalize">{event.format?.replace("_", " ")}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export default EventSelector;
