var _ = require("underscore"),
    lookup = require("./lookup");

var Autoencoder = function(options) {
  options = options || {};
  this.learningRate = options.learningRate || 0.3;
  this.momentum = options.momentum || 0.1;
  this.hiddenSizes = options.hiddenLayers;
  this.makeSparse = options.makeSparse || false;
  this.sparsityParameter = options.sparsityParameter || 0.05;
  this.beta = options.sparsityPenalty || 0.1;
}

Autoencoder.prototype = {
  initialize: function(sizes) {
    this.sizes = sizes;
    this.outputLayer = this.sizes.length - 1;
    this.hiddenLayer = this.outputLayer - 1;

    this.biases = []; // weights for bias nodes
    this.weights = [];
    this.outputs = [];

    // state for training
    this.deltas = [];
    this.changes = []; // for momentum
    this.errors = [];
    
    // Sum of the output of hidden layer units for sparsity calculation
    this.hiddenSums = zeros(this.hiddenSizes);
	// To store average activation of hidden layer nodes
    this.avgHiddenActivation = [];

    for (var layer = 0; layer <= this.outputLayer; layer++) {
      var size = this.sizes[layer];
      this.deltas[layer] = zeros(size);
      this.errors[layer] = zeros(size);
      this.outputs[layer] = zeros(size);

      if (layer > 0) {
        this.biases[layer] = randos(size);
        this.weights[layer] = new Array(size);
        this.changes[layer] = new Array(size);

        for (var node = 0; node < size; node++) {
          var prevSize = this.sizes[layer - 1];
          this.weights[layer][node] = randos(prevSize);
          this.changes[layer][node] = zeros(prevSize);
        }
      }
    }
  },

  run: function(input) {
    if (this.inputLookup) {
      input = lookup.toArray(this.inputLookup, input);
    }

    var output = this.runInput(input);

    if (this.outputLookup) {
      output = lookup.toHash(this.outputLookup, output);
    }
    return output;
  },

  runInput: function(input) {
    this.outputs[0] = input;  // set output state of input layer

    for (var layer = 1; layer <= this.outputLayer; layer++) {
      for (var node = 0; node < this.sizes[layer]; node++) {
        var weights = this.weights[layer][node];

        var sum = this.biases[layer][node];
        for (var k = 0; k < weights.length; k++) {
          sum += weights[k] * input[k];
        }
        this.outputs[layer][node] = 1 / (1 + Math.exp(-sum));
      }
      var output = input = this.outputs[layer];
    }
    return output;
  },
  
  computeHiddenSums: function() {
  	 for(var node = 0; node < this.sizes[this.hiddenLayer]; node++) {
        	this.hiddenSums[node] += this.outputs[this.hiddenLayer][node];
     }
  },

  train: function(data, options) {
    data = this.formatData(data);

    options = options || {};
    var iterations = options.iterations || 20000;
    var errorThresh = options.errorThresh || 0.005;
    var log = options.log || false;
    var logPeriod = options.logPeriod || 10;
    var callback = options.callback;
    var callbackPeriod = options.callbackPeriod || 10;

    var inputSize = data[0].input.length;
    var outputSize = data[0].input.length;

    var hiddenSizes = this.hiddenSizes;
    if (!hiddenSizes) {
      hiddenSizes = [Math.max(3, Math.floor(inputSize / 2))];
    }
    var sizes = _([inputSize, hiddenSizes, outputSize]).flatten();
    this.initialize(sizes);
     
    var error = 1;
    for (var i = 0; i < iterations && error > errorThresh; i++) {
      var sum = 0;

		// If training a sparse autoencoder
		if (this.makeSparse) {
		    // Run through input data once to calculate hidden outputs
			for (var j = 0; j < data.length; j++) {
		    	this.runInput(data[j].input);
			    this.computeHiddenSums();
			}
		  
		  	// Calculate average activation of hidden nodes
			for(var node = 0; node < this.sizes[this.hiddenLayer]; node++){
				this.avgHiddenActivation[node] = this.hiddenSums[node] / data.length;
			}

		 	
		 	//console.log(this.hiddenSums);
			//if(iterations%10 == 0)
			//	console.log(this.avgHiddenActivation);

			// Reset hidden sums for new iteration
			this.hiddenSums = zeros(this.hiddenSizes);
		}	  

		for (var j = 0; j < data.length; j++) {
        	var err = this.trainPattern(data[j].input, data[j].output);
	        sum += err;
      	}
      	error = sum / data.length;
      	
		var totalerror = error * this.errors[this.outputLayer].length;

		if (log && (i % logPeriod === 0)) {
	        console.log("iterations:", i, "training error:", error);
	        var hsum = 0;
			for(var node = 0; node < this.sizes[this.hiddenLayer]; node++){
	    		hsum += this.avgHiddenActivation[node];
			}
			if (this.makeSparse) {
				console.log("Avg Hidden activation:", hsum/this.hiddenSizes);
			}
    	}
    	if (callback && (i % callbackPeriod === 0)) {
    	    callback({ error: error, iterations: i });
   		}
    }

    return {
      error: error,
      iterations: i
    };
  },

  trainPattern : function(input, output) {
    // forward propogate
    this.runInput(input);
	  
    // back propogate
    this.calculateDeltas(output);
    this.adjustWeights();

    var error = mse(this.errors[this.outputLayer]);
    return error;
  },

  calculateDeltas: function(target) {
   
    for (var layer = this.outputLayer; layer >= 0; layer--) {
      for (var node = 0; node < this.sizes[layer]; node++) {
        var output = this.outputs[layer][node];

        var error = 0;

        if (layer == this.outputLayer) {
          error = target[node] - output;
        }
        else {
          var deltas = this.deltas[layer + 1];
          for (var k = 0; k < deltas.length; k++) {
            error += deltas[k] * this.weights[layer + 1][k][node];
          }
        }
        this.errors[layer][node] = error;
		// For sparse autoencoder, consider the sparsity factor during computation of hidden later deltas
        if(this.makeSparse && layer == this.hiddenLayer){
        	var avgNodeActivation = this.avgHiddenActivation[node];
			// This line is supposed to work but for some reason does not converge
			var sparsityComponent = ((-this.sparsityParameter / avgNodeActivation) + (1 - this.sparsityParameter) / (1 - avgNodeActivation));
            this.deltas[layer][node] = (error + this.beta * sparsityComponent) * output * (1 - output);
        } else {
	        this.deltas[layer][node] = error * output * (1 - output);
	    }
      }
    }
  },

  adjustWeights: function() {
    for (var layer = 1; layer <= this.outputLayer; layer++) {
      var incoming = this.outputs[layer - 1];

      for (var node = 0; node < this.sizes[layer]; node++) {
        var delta = this.deltas[layer][node];

        for (var k = 0; k < incoming.length; k++) {
          var change = this.changes[layer][node][k];

          change = (this.learningRate * delta * incoming[k])
                   + (this.momentum * change);

          this.changes[layer][node][k] = change;
          this.weights[layer][node][k] += change;
        }
        this.biases[layer][node] += this.learningRate * delta;
      }
    }
  },

  formatData: function(data) {
    // turn sparse hash input into arrays with 0s as filler
    if (!_(data[0].input).isArray()) {
      if (!this.inputLookup) {
        this.inputLookup = lookup.buildLookup(_(data).pluck("input"));
      }
      data = data.map(function(datum) {
        var array = lookup.toArray(this.inputLookup, datum.input)
        return _(_(datum).clone()).extend({ input: array });
      }, this);
    }

    if (!_(data[0].output).isArray()) {
      if (!this.outputLookup) {
        this.outputLookup = lookup.buildLookup(_(data).pluck("input"));
      }
      data = data.map(function(datum) {
        var array = lookup.toArray(this.outputLookup, datum.output);
        return _(_(datum).clone()).extend({ output: array });
      }, this);
    }
    return data;
  },

  toJSON: function() {
    /* make json look like:
      {
        layers: [
          { x: {},
            y: {}},
          {'0': {bias: -0.98771313, weights: {x: 0.8374838, y: 1.245858},
           '1': {bias: 3.48192004, weights: {x: 1.7825821, y: -2.67899}}},
          { f: {bias: 0.27205739, weights: {'0': 1.3161821, '1': 2.00436}}}
        ]
      }
    */
    var layers = [];
    for (var layer = 0; layer <= this.outputLayer; layer++) {
      layers[layer] = {};

      var nodes;
      // turn any internal arrays back into hashes for readable json
      if (layer == 0 && this.inputLookup) {
        nodes = _(this.inputLookup).keys();
      }
      else if (layer == this.outputLayer && this.outputLookup) {
        nodes = _(this.outputLookup).keys();
      }
      else {
        nodes = _.range(0, this.sizes[layer]);
      }

      for (var j = 0; j < nodes.length; j++) {
        var node = nodes[j];
        layers[layer][node] = {};

        if (layer > 0) {
          layers[layer][node].bias = this.biases[layer][j];
          layers[layer][node].weights = {};
          for (var k in layers[layer - 1]) {
            var index = k;
            if (layer == 1 && this.inputLookup) {
              index = this.inputLookup[k];
            }
            layers[layer][node].weights[k] = this.weights[layer][j][index];
          }
        }
      }
    }
    return { layers: layers };
  },

  fromJSON: function(json) {
    var size = json.layers.length;
    this.outputLayer = size - 1;

    this.sizes = new Array(size);
    this.weights = new Array(size);
    this.biases = new Array(size);
    this.outputs = new Array(size);

    for (var i = 0; i <= this.outputLayer; i++) {
      var layer = json.layers[i];
      if (i === 0 && !layer[0]) {
        this.inputLookup = lookup.lookupFromHash(layer);
      }
      else if (i == this.outputLayer && !layer[0]) {
        this.outputLookup = lookup.lookupFromHash(layer);
      }

      var nodes = _(layer).keys();
      this.sizes[i] = nodes.length;
      this.weights[i] = [];
      this.biases[i] = [];
      this.outputs[i] = [];

      for (var j in nodes) {
        var node = nodes[j];
        this.biases[i][j] = layer[node].bias;
        this.weights[i][j] = _(layer[node].weights).toArray();
      }
    }
    return this;
  },

   toFunction: function() {
    var json = this.toJSON();
    // return standalone function that mimics run()
    return new Function("input",
'  var net = ' + JSON.stringify(json) + ';\n\n\
  for (var i = 1; i < net.layers.length; i++) {\n\
    var layer = net.layers[i];\n\
    var output = {};\n\
    \n\
    for (var id in layer) {\n\
      var node = layer[id];\n\
      var sum = node.bias;\n\
      \n\
      for (var iid in node.weights) {\n\
        sum += node.weights[iid] * input[iid];\n\
      }\n\
      output[id] = (1 / (1 + Math.exp(-sum)));\n\
    }\n\
    input = output;\n\
  }\n\
  return output;');
  }
}

function randomWeight() {
  return Math.random() * 0.05 - 0.02;
}

function zeros(size) {
  var array = new Array(size);
  for (var i = 0; i < size; i++) {
    array[i] = 0;
  }
  return array;
}

function randos(size) {
  var array = new Array(size);
  for (var i = 0; i < size; i++) {
    array[i] = randomWeight();
  }
  return array;
}

function mse(errors) {
  // mean squared error
  var sum = 0;
  for (var i = 0; i < errors.length; i++) {
    sum += Math.pow(errors[i], 2);
  }
  return sum / errors.length;
}

exports.Autoencoder = Autoencoder;
