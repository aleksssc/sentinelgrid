package realtime

import "context"

type InventoryRequest struct {
	Context context.Context
	Done    chan error
}

// The service loop owns both the cache and the API client's inventory acknowledgement.
var InventoryRequests = make(chan InventoryRequest)

func executeForceInventory(ctx context.Context) (map[string]any, string, error) {
	request := InventoryRequest{Context: ctx, Done: make(chan error, 1)}
	select {
	case InventoryRequests <- request:
	case <-ctx.Done():
		return nil, "INVENTORY_TIMEOUT", ctx.Err()
	}
	select {
	case err := <-request.Done:
		if err != nil {
			return nil, "INVENTORY_REFRESH_FAILED", err
		}
		return map[string]any{"action": "force_inventory", "inventory_accepted": true}, "", nil
	case <-ctx.Done():
		return nil, "INVENTORY_TIMEOUT", ctx.Err()
	}
}
