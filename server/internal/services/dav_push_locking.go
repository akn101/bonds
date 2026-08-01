package services

import "sync"

type contactDAVOperationLockRegistry struct {
	mu    sync.Mutex
	locks map[string]*contactDAVOperationLock
}

type contactDAVOperationLock struct {
	mu         sync.Mutex
	references int
}

func (r *contactDAVOperationLockRegistry) lock(contactID string) func() {
	r.mu.Lock()
	if r.locks == nil {
		r.locks = make(map[string]*contactDAVOperationLock)
	}
	operationLock := r.locks[contactID]
	if operationLock == nil {
		operationLock = &contactDAVOperationLock{}
		r.locks[contactID] = operationLock
	}
	operationLock.references++
	r.mu.Unlock()

	operationLock.mu.Lock()
	return func() {
		operationLock.mu.Unlock()
		r.mu.Lock()
		operationLock.references--
		if operationLock.references == 0 {
			delete(r.locks, contactID)
		}
		r.mu.Unlock()
	}
}
